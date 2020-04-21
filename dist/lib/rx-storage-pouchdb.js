"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getPouchLocation = getPouchLocation;
exports.getRxStoragePouchDb = getRxStoragePouchDb;
exports.RxStoragePouchDbClass = void 0;

var _pouchdbSelectorCore = require("pouchdb-selector-core");

var _util = require("./util");

var _hooks = require("./hooks");

var _pouchDb = require("./pouch-db");

var _rxError = require("./rx-error");

var RxStoragePouchDbClass = /*#__PURE__*/function () {
  function RxStoragePouchDbClass(adapter) {
    var pouchSettings = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    this.name = 'pouchdb';
    this.adapter = adapter;
    this.pouchSettings = pouchSettings;
  }

  var _proto = RxStoragePouchDbClass.prototype;

  _proto.getSortComparator = function getSortComparator(primaryKey, query) {
    var _ref;

    var sortOptions = query.sort ? query.sort : [(_ref = {}, _ref[primaryKey] = 'asc', _ref)];
    var massagedSelector = (0, _pouchdbSelectorCore.massageSelector)(query.selector);
    var inMemoryFields = Object.keys(query.selector);

    var fun = function fun(a, b) {
      // TODO use createFieldSorter
      // TODO make a performance test
      var rows = [a, b].map(function (doc) {
        // swap primary to _id
        var cloned = (0, _util.flatClone)(doc);
        var primaryValue = cloned[primaryKey];
        delete cloned[primaryKey];
        cloned._id = primaryValue;
        return {
          doc: cloned
        };
      });
      var sortedRows = (0, _pouchdbSelectorCore.filterInMemoryFields)(rows, {
        selector: massagedSelector,
        sort: sortOptions
      }, inMemoryFields);

      if (sortedRows[0].doc._id === rows[0].doc._id) {
        return -1;
      } else {
        return 1;
      }
    };

    return fun;
  }
  /**
   * @link https://github.com/pouchdb/pouchdb/blob/master/packages/node_modules/pouchdb-selector-core/src/matches-selector.js
   */
  ;

  _proto.getQueryMatcher = function getQueryMatcher(primaryKey, query) {
    var massagedSelector = (0, _pouchdbSelectorCore.massageSelector)(query.selector);

    var fun = function fun(doc) {
      // swap primary to _id
      var cloned = (0, _util.flatClone)(doc);
      var primaryValue = cloned[primaryKey];
      delete cloned[primaryKey];
      cloned._id = primaryValue;
      var row = {
        doc: cloned
      };
      var rowsMatched = (0, _pouchdbSelectorCore.filterInMemoryFields)([row], {
        selector: massagedSelector
      }, Object.keys(query.selector));
      return rowsMatched && rowsMatched.length === 1;
    };

    return fun;
  };

  _proto.createStorageInstance = function createStorageInstance(databaseName, collectionName, schemaVersion) {
    var options = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

    if (!options.pouchSettings) {
      options.pouchSettings = {};
    }

    var pouchLocation = getPouchLocation(databaseName, collectionName, schemaVersion);
    var pouchDbParameters = {
      location: pouchLocation,
      adapter: (0, _util.adapterObject)(this.adapter),
      settings: options.pouchSettings
    };
    var pouchDBOptions = Object.assign({}, pouchDbParameters.adapter, this.pouchSettings, pouchDbParameters.settings);
    (0, _hooks.runPluginHooks)('preCreatePouchDb', pouchDbParameters);
    return new _pouchDb.PouchDB(pouchDbParameters.location, pouchDBOptions);
  };

  _proto.createInternalStorageInstance = function createInternalStorageInstance(databaseName, _options) {
    var storageInstance = this.createStorageInstance(databaseName, '_rxdb_internal', 0, {
      pouchSettings: {
        // no compaction because this only stores local documents
        auto_compaction: false,
        revs_limit: 1
      }
    });
    return Promise.resolve(storageInstance);
  }
  /**
   * pouchdb has many bugs and strange behaviors
   * this functions takes a normal mango query
   * and transforms it to one that fits for pouchdb
   */
  ;

  _proto.prepareQuery = function prepareQuery(rxQuery, mutateableQuery) {
    var primPath = rxQuery.collection.schema.primaryPath;
    var query = mutateableQuery;
    /**
     * because sort wont work on unused keys we have to workarround
     * so we add the key to the selector if necessary
     * @link https://github.com/nolanlawson/pouchdb-find/issues/204
     */

    if (query.sort) {
      query.sort.forEach(function (sortPart) {
        var key = Object.keys(sortPart)[0];

        if (!query.selector[key] || !query.selector[key].$gt) {
          var schemaObj = rxQuery.collection.schema.getSchemaByObjectPath(key);

          if (!schemaObj) {
            throw (0, _rxError.newRxError)('QU5', {
              key: key
            });
          }

          if (!query.selector[key]) {
            query.selector[key] = {};
          }

          switch (schemaObj.type) {
            case 'number':
            case 'integer':
              // TODO change back to -Infinity when issue resolved
              // @link https://github.com/pouchdb/pouchdb/issues/6454
              // -Infinity does not work since pouchdb 6.2.0
              query.selector[key].$gt = -9999999999999999999999999999;
              break;

            case 'string':
              /**
               * strings need an empty string, see
               * @link https://github.com/pubkey/rxdb/issues/585
               */
              if (typeof query.selector[key] !== 'string') {
                query.selector[key].$gt = '';
              }

              break;

            default:
              query.selector[key].$gt = null;
              break;
          }
        }
      });
    } // regex does not work over the primary key
    // TODO move this to dev mode


    if (query.selector[primPath] && query.selector[primPath].$regex) {
      throw (0, _rxError.newRxError)('QU4', {
        path: primPath,
        query: rxQuery.mangoQuery
      });
    } // primary-swap sorting


    if (query.sort) {
      var sortArray = query.sort.map(function (part) {
        var _newPart;

        var key = Object.keys(part)[0];
        var direction = Object.values(part)[0];
        var useKey = key === primPath ? '_id' : key;
        var newPart = (_newPart = {}, _newPart[useKey] = direction, _newPart);
        return newPart;
      });
      query.sort = sortArray;
    } // strip empty selectors


    Object.entries(query.selector).forEach(function (_ref2) {
      var k = _ref2[0],
          v = _ref2[1];

      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) {
        delete query.selector[k];
      }
    }); // primary swap

    if (primPath !== '_id' && query.selector[primPath]) {
      // selector
      query.selector._id = query.selector[primPath];
      delete query.selector[primPath];
    } // if no selector is used, pouchdb has a bug, so we add a default-selector


    if (Object.keys(query.selector).length === 0) {
      query.selector = {
        _id: {}
      };
    }

    return query;
  };

  return RxStoragePouchDbClass;
}();
/**
 * returns the pouchdb-database-name
 */


exports.RxStoragePouchDbClass = RxStoragePouchDbClass;

function getPouchLocation(dbName, collectionName, schemaVersion) {
  var prefix = dbName + '-rxdb-' + schemaVersion + '-';

  if (!collectionName.includes('/')) {
    return prefix + collectionName;
  } else {
    // if collectionName is a path, we have to prefix the last part only
    var split = collectionName.split('/');
    var last = split.pop();
    var ret = split.join('/');
    ret += '/' + prefix + last;
    return ret;
  }
}

function getRxStoragePouchDb(adapter, pouchSettings) {
  if (!adapter) {
    throw new Error('adapter missing');
  }

  return new RxStoragePouchDbClass(adapter, pouchSettings);
}

//# sourceMappingURL=rx-storage-pouchdb.js.map