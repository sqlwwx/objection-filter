'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * A wrapper around the objection.js model class
 * For 'where' you cannot have combinations of properties in a single AND condition
 * e.g.
 * {
 *   $and: {
 *     'a.b.c': 1,
 *     'b.e': 2
 *   },
 *   $or: [
 *      {}
 *   ]
 * }
 *
 * However, for 'require' conditions, this might be possible since ALL variables exist
 * in the same scope, since there's a join
 */
var _ = require('lodash');

var _require = require('../config'),
    debug = _require.debug;

var _require2 = require('./utils'),
    sliceRelation = _require2.sliceRelation,
    Operations = _require2.Operations;

var _require3 = require('./ExpressionBuilder'),
    createRelationExpression = _require3.createRelationExpression;

var _require4 = require('./LogicalIterator'),
    iterateLogicalExpression = _require4.iterateLogicalExpression,
    getPropertiesFromExpression = _require4.getPropertiesFromExpression;

module.exports = function () {
  /**
   * @param {Model} Model
   * @param {Transaction} trx
   * @param {Object} options.operators Custom operator handlers
   */
  function FilterQueryBuilder(Model, trx) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

    _classCallCheck(this, FilterQueryBuilder);

    this.Model = Model;
    this._builder = Model.query(trx);

    var _options$operators = options.operators,
        operators = _options$operators === undefined ? {} : _options$operators,
        onAggBuild = options.onAggBuild;

    // Initialize instance specific utilities

    this.utils = Operations({ operators: operators, onAggBuild: onAggBuild });
  }

  _createClass(FilterQueryBuilder, [{
    key: 'build',
    value: function build() {
      var params = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
      var fields = params.fields,
          limit = params.limit,
          offset = params.offset,
          order = params.order,
          eager = params.eager;


      applyFields(fields, this._builder);
      applyWhere(params.where, this._builder, this.utils);
      applyRequire(params.require, this._builder, this.utils);

      applyOrder(order, this._builder);
      applyEager(eager, this._builder, this.utils);
      applyLimit(limit, offset, this._builder);

      return this._builder;
    }
  }, {
    key: 'count',
    value: function count() {
      return this._builder.clone().clear(/orderBy|offset|limit/).clearEager().count('* AS count').pluck('count').first();
    }

    /**
     * @param {String} exp The objection.js eager expression
     */

  }, {
    key: 'allowEager',
    value: function allowEager(eagerExpression) {
      this._builder.allowEager(eagerExpression);

      return this;
    }
  }]);

  return FilterQueryBuilder;
}();

/**
 * Based on a relation string, get the outer most model
 * @param {QueryBuilder} builder
 * @param {String} relation
 */
var getOuterModel = function getOuterModel(builder, relation) {
  var Model = builder.modelClass();
  var CurrentModel = Model;
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = relation.split('.')[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var relationName = _step.value;

      var currentRelation = CurrentModel.getRelations()[relationName];
      CurrentModel = currentRelation.relatedModelClass;
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator.return) {
        _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  return CurrentModel;
};

/**
 * Return a case statement which fills nulls with zeroes
 * @param {String} alias
 */
var nullToZero = function nullToZero(knex, tableAlias) {
  var columnAlias = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'count';

  var column = tableAlias + '.' + columnAlias;
  return knex.raw('case when ?? is null then 0 ' + 'else cast(?? as decimal) end as ??', [column, column, columnAlias]);
};

// A list of allowed aggregation functions
var aggregationFunctions = ['count', 'sum', 'min', 'max', 'avg'];

/**
 * Build a single aggregation into a target alias on a query builder
 * Defaults to count, but anything in aggregationFunctions can be used
 * @param {Object} aggregation
 * @param {QueryBuilder} builder
 * @param {Object} utils
 */
var buildAggregation = function buildAggregation(aggregation, builder, utils) {
  var Model = builder.modelClass();
  var knex = Model.knex();
  var relation = aggregation.relation,
      $where = aggregation.$where,
      _aggregation$distinct = aggregation.distinct,
      distinct = _aggregation$distinct === undefined ? false : _aggregation$distinct,
      _aggregation$alias = aggregation.alias,
      columnAlias = _aggregation$alias === undefined ? 'count' : _aggregation$alias,
      _aggregation$type = aggregation.type,
      type = _aggregation$type === undefined ? 'count' : _aggregation$type,
      field = aggregation.field;
  var onAggBuild = utils.onAggBuild;

  // Do some initial validation

  if (!aggregationFunctions.includes(type)) {
    throw new Error('Invalid type [' + type + '] for aggregation');
  }
  if (type !== 'count' && !field) {
    throw new Error('Must specify "field" with [' + type + '] aggregation');
  }

  var baseIdColumn = typeof Model.idColumn === 'string' ? Model.tableName + '.' + Model.idColumn : Model.idColumn.map(function (idColumn) {
    return Model.tableName + '.' + idColumn;
  });

  // When joining the filter query, the base left-joined table is aliased
  // as the full relation name joined by the : character
  var relationNames = relation.split('.');
  var fullOuterRelation = relationNames.join(':');

  // Filtering starts using the outermost model as a base
  var OuterModel = getOuterModel(builder, relation);

  var idColumns = _.isArray(OuterModel.idColumn) ? OuterModel.idColumn : [OuterModel.idColumn];
  var fullIdColumns = idColumns.map(function (idColumn) {
    return fullOuterRelation + '.' + idColumn;
  });

  // Create the subquery for the aggregation with the base model as a starting point
  var distinctTag = distinct ? 'distinct ' : '';
  var aggregationQuery = Model.query().select(baseIdColumn).select(knex.raw(type + '(' + distinctTag + '??) as ??', [fullOuterRelation + '.' + (field || OuterModel.idColumn), columnAlias])).leftJoinRelation(relation);

  // Apply filters to models on the aggregation path
  if (onAggBuild) {
    var currentModel = Model;
    var relationStack = [];
    var _iteratorNormalCompletion2 = true;
    var _didIteratorError2 = false;
    var _iteratorError2 = undefined;

    try {
      var _loop = function _loop() {
        var relationName = _step2.value;

        relationStack.push(relationName);
        var relatedModelClass = currentModel.getRelations()[relationName].relatedModelClass;

        var query = onAggBuild(relatedModelClass);
        var fullyQualifiedRelation = relationStack.join(':');
        if (query) {
          var aggModelAlias = fullyQualifiedRelation + '_agg';
          aggregationQuery.innerJoin(query.as(aggModelAlias), function () {
            this.on(aggModelAlias + '.' + relatedModelClass.idColumn, '=', fullyQualifiedRelation + '.' + relatedModelClass.idColumn);
          });
        }
        currentModel = relatedModelClass;
      };

      for (var _iterator2 = relation.split('.')[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
        _loop();
      }
    } catch (err) {
      _didIteratorError2 = true;
      _iteratorError2 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion2 && _iterator2.return) {
          _iterator2.return();
        }
      } finally {
        if (_didIteratorError2) {
          throw _iteratorError2;
        }
      }
    }
  }

  // Apply the filtering using the outer model as a starting point
  var filterQuery = OuterModel.query();
  applyRequire($where, filterQuery, utils);
  var filterQueryAlias = 'filter_query';
  aggregationQuery.innerJoin(filterQuery.as(filterQueryAlias), function () {
    var _this = this;

    fullIdColumns.forEach(function (fullIdColumn, index) {
      _this.on(fullIdColumn, '=', filterQueryAlias + '.' + idColumns[index]);
    });
  });

  aggregationQuery.groupBy(baseIdColumn);

  return aggregationQuery;
};

var applyAggregations = function applyAggregations() {
  var aggregations = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var builder = arguments[1];
  var utils = arguments[2];

  if (aggregations.length === 0) return;

  var Model = builder.modelClass();
  var knex = Model.knex();
  var aggAlias = function aggAlias(i) {
    return 'agg_' + i;
  };
  var idColumns = _.isArray(Model.idColumn) ? Model.idColumn : [Model.idColumn];
  var fullIdColumns = idColumns.map(function (id) {
    return Model.tableName + '.' + id;
  });

  var aggregationQueries = aggregations.map(function (aggregation) {
    return buildAggregation(aggregation, builder, utils);
  });

  // Create a replicated subquery equivalent to the base model + aggregations
  var fullQuery = Model.query().select(Model.tableName + '.*');

  // For each aggregation query, select the aggregation then join onto the full query
  aggregationQueries.forEach(function (query, i) {
    var nullToZeroStatement = nullToZero(knex, aggAlias(i), aggregations[i].alias);
    fullQuery.select(nullToZeroStatement).leftJoin(query.as(aggAlias(i)), function () {
      var _this2 = this;

      fullIdColumns.forEach(function (fullIdColumn, j) {
        _this2.on(fullIdColumn, '=', aggAlias(i) + '.' + idColumns[j]);
      });
    });
  });

  // Finally, build the base query
  builder.from(fullQuery.as(Model.tableName));
};

/**
 * Apply an object notation eager object with scope based filtering
 * @param {Object} expression
 * @param {QueryBuilder} builder
 * @param {Array<string>} path An array of the current relation
 * @param {Object} utils
 */
var applyEagerFilter = function applyEagerFilter() {
  var expression = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var builder = arguments[1];
  var path = arguments[2];
  var utils = arguments[3];

  debug('applyEagerFilter(', { expression: expression, path: path }, ')');

  // Apply a where on the root model
  if (expression.$where) {
    var filterCopy = Object.assign({}, expression.$where);
    applyRequire(filterCopy, builder, utils);
    delete expression.$where;
  }

  // Apply an aggregation set on the root model
  if (expression.$aggregations) {
    applyAggregations(expression.$aggregations, builder, utils);
    delete expression.$aggregations;
  }

  // Walk the eager tree
  for (var lhs in expression) {
    var rhs = expression[lhs];
    debug('Eager Filter lhs[' + lhs + '] rhs[' + JSON.stringify(rhs) + ']');

    if (typeof rhs === 'boolean' || typeof rhs === 'string') continue;

    // rhs is an object
    var eagerName = rhs.$relation ? rhs.$relation + ' as ' + lhs : lhs;

    // including aliases e.g. "a as b.c as d"
    var newPath = path.concat(eagerName);
    var relationExpression = newPath.join('.');

    if (rhs.$where) {
      (function () {
        debug('modifyEager(', { relationExpression: relationExpression, filter: rhs.$where }, ')');
        var filterCopy = Object.assign({}, rhs.$where);

        // TODO: Could potentially apply all 'modifyEagers' at the end
        builder.modifyEager(relationExpression, function (subQueryBuilder) {
          applyRequire(filterCopy, subQueryBuilder, utils);
        });

        delete rhs.$where;

        expression[lhs] = rhs;
      })();
    }

    if (Object.keys(rhs).length > 0) {
      applyEagerFilter(rhs, builder, newPath, utils);
    }
  }

  return expression;
};

var applyEagerObject = function applyEagerObject(expression, builder, utils) {
  var expressionWithoutFilters = applyEagerFilter(expression, builder, [], utils);
  builder.eager(expressionWithoutFilters);
};

var applyEager = function applyEager(eager, builder, utils) {
  if ((typeof eager === 'undefined' ? 'undefined' : _typeof(eager)) === 'object') {
    return applyEagerObject(eager, builder, utils);
  }

  builder.eager(eager);
};
module.exports.applyEager = applyEager;

/**
 * Test if a property is a related property
 * e.g. "name" => false, "movies.name" => true
 * @param {String} name
 */
var isRelatedProperty = function isRelatedProperty(name) {
  return !!sliceRelation(name).relationName;
};

/**
 * Apply an entire require expression to the query builder
 * e.g. { "prop1": { "$like": "A" }, "prop2": { "$in": [1] } }
 * Do a first pass on the fields to create an objectionjs RelationExpression
 * This prevents joining tables multiple times, and optimizes number of joins
 * @param {Object} filter
 * @param {QueryBuilder} builder The root query builder
 */
var applyRequire = function applyRequire() {
  var filter = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var builder = arguments[1];
  var utils = arguments[2];
  var applyPropertyExpression = utils.applyPropertyExpression;

  // If there are no properties at all, just return

  var propertiesSet = getPropertiesFromExpression(filter);
  if (propertiesSet.length === 0) return builder;

  var applyLogicalExpression = iterateLogicalExpression({
    onExit: function onExit(propertyName, value, _builder) {
      applyPropertyExpression(propertyName, value, _builder);
    },
    onLiteral: function onLiteral() {
      throw new Error('Filter is invalid');
    }
  });
  var getFullyQualifiedName = function getFullyQualifiedName(name) {
    return sliceRelation(name, '.', Model.tableName).fullyQualifiedProperty;
  };

  var Model = builder.modelClass();
  var idColumns = _.isArray(Model.idColumn) ? Model.idColumn : [Model.idColumn];
  var fullIdColumns = idColumns.map(function (idColumn) {
    return Model.tableName + '.' + idColumn;
  });

  // If there are no related properties, don't join
  var relatedPropertiesSet = propertiesSet.filter(isRelatedProperty);
  if (relatedPropertiesSet.length === 0) {
    applyLogicalExpression(filter, builder, false, getFullyQualifiedName);
  } else {
    var _Model$query;

    var filterQuery = (_Model$query = Model.query()).distinct.apply(_Model$query, _toConsumableArray(fullIdColumns));

    applyLogicalExpression(filter, filterQuery, false, getFullyQualifiedName);

    // If there were related properties, join onto the filter
    var joinRelation = createRelationExpression(propertiesSet);
    if (joinRelation) filterQuery.joinRelation(joinRelation);

    var filterQueryAlias = 'filter_query';
    builder.innerJoin(filterQuery.as(filterQueryAlias), function () {
      var _this3 = this;

      fullIdColumns.forEach(function (fullIdColumn, index) {
        _this3.on(fullIdColumn, '=', filterQueryAlias + '.' + idColumns[index]);
      });
    });
  }

  return builder;
};
module.exports.applyRequire = applyRequire;

/**
 * Apply an entire where expression to the query builder
 * e.g. { "prop1": { "$like": "A" }, "prop2": { "$in": [1] } }
 * For now it only supports a single operation for each property
 * but in reality, it should allow an AND of multiple operations
 * @param {Object} filter The filter object
 * @param {QueryBuilder} builder The root query builder
 */
var applyWhere = function applyWhere() {
  var filter = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var builder = arguments[1];
  var utils = arguments[2];
  var applyPropertyExpression = utils.applyPropertyExpression;

  var Model = builder.modelClass();

  _.forEach(filter, function (andExpression, property) {
    var _sliceRelation = sliceRelation(property),
        relationName = _sliceRelation.relationName,
        propertyName = _sliceRelation.propertyName;

    if (!relationName) {
      // Root level where should include the root table name
      var fullyQualifiedProperty = Model.tableName + '.' + propertyName;
      return applyPropertyExpression(fullyQualifiedProperty, andExpression, builder);
    }

    // Eager query fields should include the eager model table name
    builder.modifyEager(relationName, function (eagerBuilder) {
      var fullyQualifiedProperty = eagerBuilder.modelClass().tableName + '.' + propertyName;
      applyPropertyExpression(fullyQualifiedProperty, andExpression, eagerBuilder);
    });
  });

  return builder;
};
module.exports.applyWhere = applyWhere;

/**
 * Order the result by a root model field or order related models
 * Related properties are ordered locally (within the subquery) and not globally
 * e.g. order = "name desc, city.country.name asc"
 * @param {String} order An comma delimited order expression
 * @param {QueryBuilder} builder The root query builder
 */
var applyOrder = function applyOrder(order, builder) {
  if (!order) return;
  var Model = builder.modelClass();

  order.split(',').forEach(function (orderStatement) {
    var _orderStatement$trim$ = orderStatement.trim().split(' '),
        _orderStatement$trim$2 = _slicedToArray(_orderStatement$trim$, 2),
        orderProperty = _orderStatement$trim$2[0],
        _orderStatement$trim$3 = _orderStatement$trim$2[1],
        direction = _orderStatement$trim$3 === undefined ? 'asc' : _orderStatement$trim$3;

    var _sliceRelation2 = sliceRelation(orderProperty),
        propertyName = _sliceRelation2.propertyName,
        relationName = _sliceRelation2.relationName;

    if (!relationName) {
      // Root level where should include the root table name
      var fullyQualifiedColumn = Model.tableName + '.' + propertyName;
      return builder.orderBy(fullyQualifiedColumn, direction);
    }

    // For now, only allow sub-query ordering of eager expressions
    builder.modifyEager(relationName, function (eagerBuilder) {
      var fullyQualifiedColumn = eagerBuilder.modelClass().tableName + '.' + propertyName;
      eagerBuilder.orderBy(fullyQualifiedColumn, direction);
    });
  });

  return builder;
};
module.exports.applyOrder = applyOrder;

/**
 * Based on a relation name, select a subset of fields. Do nothing if there are no fields
 * @param {Builder} builder An instance of a knex builder
 * @param {Array<String>} fields A list of fields to select
  */
var selectFields = function selectFields() {
  var fields = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var builder = arguments[1];
  var relationName = arguments[2];

  if (fields.length === 0) return;

  var _builder$modelClass$k = builder.modelClass().knex(),
      raw = _builder$modelClass$k.raw;
  // HACK: sqlite incorrect column alias when selecting 1 column
  // TODO: investigate sqlite column aliasing on eager models


  if (fields.length === 1 && !relationName) {
    var field = fields[0].split('.')[1];
    return builder.select(raw('?? as ??', [fields[0], field]));
  }
  if (!relationName) return builder.select(fields);

  builder.modifyEager(relationName, function (eagerQueryBuilder) {
    eagerQueryBuilder.select(fields.map(function (field) {
      return eagerQueryBuilder.modelClass().tableName + '.' + field;
    }));
  });
};

/**
 * Select a limited set of fields. Use dot notation to limit eagerly loaded models.
 * @param {Array<String>} fields An array of dot notation fields
 * @param {QueryBuilder} builder The root query builder
 */
var applyFields = function applyFields() {
  var fields = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var builder = arguments[1];

  if (typeof fields === 'string') {
    fields = fields.split(',').map(function (field) {
      return field.trim();
    });
  }
  var Model = builder.modelClass();

  // Group fields by relation e.g. ["a.b.name", "a.b.id"] => {"a.b": ["name", "id"]}
  var rootFields = []; // Fields on the root model
  var fieldsByRelation = fields.reduce(function (obj, fieldName) {
    var _sliceRelation3 = sliceRelation(fieldName),
        propertyName = _sliceRelation3.propertyName,
        relationName = _sliceRelation3.relationName;

    if (!relationName) {
      rootFields.push(Model.tableName + '.' + propertyName);
    } else {
      // Push it into an array keyed by relationName
      obj[relationName] = obj[relationName] || [];
      obj[relationName].push(propertyName);
    }
    return obj;
  }, {});

  // Root fields
  selectFields(rootFields, builder);

  // Related fields
  _.map(fieldsByRelation, function (_fields, relationName) {
    return selectFields(_fields, builder, relationName);
  });

  return builder;
};
module.exports.applyFields = applyFields;

var applyLimit = function applyLimit(limit, offset, builder) {
  if (limit) builder.limit(limit);
  if (offset) builder.offset(offset);

  return builder;
};
module.exports.applyLimit = applyLimit;