'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

/**
 * The utils helpers are a set of common helpers to be passed around during
 * filter execution. It stores all default operators, custom operators and
 * functions which directly touch these operators.
 */

var _require = require('../config'),
    debug = _require.debug;

var _require2 = require('./LogicalIterator'),
    iterateLogicalExpression = _require2.iterateLogicalExpression;

/**
 * For a property "a.b.c", slice it into relationName: "a.b", "propertyName": "c" and
 * a fully qualified property "a:b.c"
 * @param {String} relatedProperty A dot notation property "a.b.c"
 * @param {String} delimiter A delimeter to use on the relation e.g. "." or ":"
 */


var sliceRelation = function sliceRelation(relatedProperty) {
  var delimiter = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '.';
  var rootTableName = arguments[2];

  var split = relatedProperty.split('.');
  var propertyName = split[split.length - 1];
  var relationName = split.slice(0, split.length - 1).join(delimiter);

  // Nested relations need to be in the format a:b:c.name
  // https://github.com/Vincit/objection.js/issues/363
  var fullyQualifiedProperty = relationName ? relationName.replace(/\./g, ':') + '.' + propertyName : rootTableName ? rootTableName + '.' + propertyName : propertyName;

  return { propertyName: propertyName, relationName: relationName, fullyQualifiedProperty: fullyQualifiedProperty };
};
module.exports.sliceRelation = sliceRelation;

var _operators = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'BETWEEN',
  in: 'IN',
  inq: 'IN',
  nin: 'NOT IN',
  neq: '!=',
  like: 'LIKE',
  nlike: 'NOT LIKE',
  ilike: 'ILIKE',
  nilike: 'NOT ILIKE',
  regexp: 'REGEXP',
  equals: null
};

/**
 * Create operation application utilities with some custom options
 * If options.operators is specified
 * @param {Object} options.operators
 * @param {Function} options.onAggBuild A utility function to filter aggregations per model
 */
module.exports.Operations = function (options) {
  var defaultOperators = Object.entries(_operators).reduce(function (obj, _ref) {
    var _ref2 = _slicedToArray(_ref, 2),
        key = _ref2[0],
        operator = _ref2[1];

    obj['$' + key] = function (property, operand, builder) {
      return operator ? builder.where(property, operator, operand) : builder.where(property, operand);
    };
    return obj;
  }, {
    '=': function _(property, operand, builder) {
      return builder.where(property, operand);
    },
    $exists: function $exists(property, operand, builder) {
      return operand ? builder.whereNotNull(property) : builder.whereNull(property);
    },
    /**
     * @param {String} property
     * @param {Array} items Must be an array of objects/values
     * @param {QueryBuilder} builder
     */
    $or: function $or(property, items, builder) {
      var onExit = function onExit(operator, value, subQueryBuilder) {
        var operationHandler = allOperators[operator];
        operationHandler(property, value, subQueryBuilder);
      };
      var onLiteral = function onLiteral(value, subQueryBuilder) {
        onExit('$equals', value, subQueryBuilder);
      };

      // Iterate the logical expression until it hits an operation e.g. $gte
      var iterateLogical = iterateLogicalExpression({ onExit: onExit, onLiteral: onLiteral });

      // Wrap within another builder context to prevent end-of-expression errors
      // TODO: Investigate the consequences of not using this wrapper
      return builder.where(function (subQueryBuilder) {
        iterateLogical({ $or: items }, subQueryBuilder, true);
      });
    },
    $and: function $and(property, items, builder) {
      var onExit = function onExit(operator, value, subQueryBuilder) {
        var operationHandler = allOperators[operator];
        operationHandler(property, value, subQueryBuilder);
      };
      var onLiteral = function onLiteral(value, subQueryBuilder) {
        onExit('$equals', value, subQueryBuilder);
      };

      // Iterate the logical expression until it hits an operation e.g. $gte
      var iterateLogical = iterateLogicalExpression({ onExit: onExit, onLiteral: onLiteral });

      // Wrap within another builder context to prevent end-of-expression errors
      return builder.where(function (subQueryBuilder) {
        iterateLogical({ $and: items }, subQueryBuilder, false);
      });
    }
  });

  var operators = options.operators,
      onAggBuild = options.onAggBuild;

  // Custom operators take override default operators

  var allOperators = Object.assign({}, defaultOperators, operators);

  /**
   * Apply a subset of operators on a single property
   * @param {String} propertyName
   * @param {Object} expression
   * @param {QueryBuilder} builder
   */
  var applyPropertyExpression = function applyPropertyExpression(propertyName, expression, builder) {
    debug('Handling property[' + propertyName + '] expression[' + JSON.stringify(expression) + ']');

    // If the rhs is a primitive, assume equality
    if ((typeof expression === 'undefined' ? 'undefined' : _typeof(expression)) !== 'object') return allOperators.$equals(propertyName, expression, builder);

    for (var lhs in expression) {
      var operationHandler = allOperators[lhs];
      var rhs = expression[lhs];

      if (!operationHandler) {
        debug('The operator [' + lhs + '] does not exist, skipping');
        continue;
      }

      operationHandler(propertyName, rhs, builder);
    }
  };

  return { applyPropertyExpression: applyPropertyExpression, onAggBuild: onAggBuild };
};