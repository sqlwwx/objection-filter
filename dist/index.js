'use strict';

var FilterQueryBuilder = require('./lib/FilterQueryBuilder');

var _require = require('./lib/utils'),
    sliceRelation = _require.sliceRelation;

var _require2 = require('./lib/ExpressionBuilder'),
    createRelationExpression = _require2.createRelationExpression;

module.exports = {
  buildFilter: function buildFilter(modelClass, trx, options) {
    return new FilterQueryBuilder(modelClass, trx, options);
  },
  FilterQueryBuilder: FilterQueryBuilder,
  sliceRelation: sliceRelation,
  createRelationExpression: createRelationExpression
};