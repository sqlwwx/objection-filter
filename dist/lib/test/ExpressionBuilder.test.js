'use strict';

require('chai').should();

var _require = require('chai'),
    expect = _require.expect;

var _require2 = require('../ExpressionBuilder'),
    createRelationExpression = _require2.createRelationExpression;

describe('utilities and helpers', function () {
  describe('createRelationExpression', function () {
    it('should return undefined with no fields', function () {
      expect(createRelationExpression([])).to.be.undefined;
    });

    it('should return undefined with only base fields', function () {
      expect(createRelationExpression(['id'])).to.be.undefined;
    });

    it('should create a single level expression with 1 field', function () {
      createRelationExpression(['relatedModel.id']).should.equal('relatedModel');
    });

    it('should create a single level expression with multiple fields', function () {
      createRelationExpression(['relatedModel.id', 'anotherRelatedModel.id']).should.equal('[relatedModel,anotherRelatedModel]');
    });

    it('should create a 2-level expression with 1 field', function () {
      createRelationExpression(['relatedModelA.relatedModelA1.id']).should.equal('relatedModelA.relatedModelA1');
    });

    it('should create a 2-level expression with 2 fields with the same first relation', function () {
      createRelationExpression(['relatedModelA.relatedModelA1.id', 'relatedModelA.relatedModelA2.id']).should.equal('relatedModelA.[relatedModelA1,relatedModelA2]');
    });

    it('should create a 2-level expression with mixed fields', function () {
      createRelationExpression(['relatedModelA.relatedModelA1.id', 'relatedModelA.relatedModelA2.id', 'relatedModelB.name']).should.equal('[relatedModelA.[relatedModelA1,relatedModelA2],relatedModelB]');

      createRelationExpression(['relatedModelA.relatedModelA1.id', 'relatedModelA.relatedModelA2.id', 'relatedModelB.relatedModelB1.id', 'relatedModelB.relatedModelB2.id']).should.equal('[relatedModelA.[relatedModelA1,relatedModelA2],relatedModelB.[relatedModelB1,relatedModelB2]]');
    });
  });
});