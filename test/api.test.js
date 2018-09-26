'use strict';

const _ = require('lodash');
require('chai').should();
const testUtils = require('./utils');
const { buildFilter } = require('../src');
const { raw, QueryBuilder } = require('objection');
const assert = require('assert');

const parseWhereIn = (where) => {
  Object.entries(where).forEach(([key, value]) => {
    if (['$or', '$and'].includes(key)) {
      value.forEach(parseWhereIn)
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        where[key] = { '$in': value }
      } else {
        delete where[key]
      }
    }
  })
}

// https://loopback.io/doc/en/lb2/Where-filter.html
const parseFilter = ({ limit = 100, fields, offset = 0, order = 'id', where = {}, include = {} }) => {
  let filter = { limit, offset, order, fields }
  assert(typeof filter.order === 'string', 'order should be string')
  parseWhereIn(where)
  if (typeof include === 'string') {
    filter.eager = include
    filter.require = where
  } else {
    include.$where = where
    filter.eager = include
  }
  return filter
}

const buildCustomFilter = (Model, filter, { trx, ...context }= {}) => {
  const builder = context.builder = buildFilter(Model, trx, context)
  let query = builder.build(parseFilter(filter))
  if (filter.count) {
    filter.count.forEach((c) => query.count(c))
  }
  if (filter.groupBy) {
    query.groupBy(filter.groupBy)
  }
  if (filter.measure) {
    filter.measure.forEach(sum => query.sum(sum))
  }
  // todo: remove selectRaw
  if (filter.selectRaw) {
    query.select(raw(filter.selectRaw, []))
  }
  return query
}

describe('basic filters', function () {

  _.each(testUtils.testDatabaseConfigs, function (knexConfig) {

    describe(knexConfig.client, function() {
      var session, knex, Person, Animal, Movie, MovieVersion;

      before(function () {
        session = testUtils.initialize(knexConfig);
        knex = session.knex;
        Person = session.models.Person;
        Animal = session.models.Animal;
        Movie = session.models.Movie;
        MovieVersion = session.models.MovieVersion;
        Person.find = function (filter) {
          return buildCustomFilter(Person, filter, {
            operators: {
              $equalsLower: (property, operand, builder) =>
                builder.whereRaw('LOWER(??) = LOWER(?)', [property, operand])
            }
          })
        }
      });

      before(function () {
        return testUtils.dropDb(session);
      });

      before(function () {
        return testUtils.createDb(session);
      });

      before(function () {
        return testUtils.insertData(session, {persons: 10, pets: 10, movies: 10});
      });

      describe('limit & offset', () => {
        it('default limit & offset', () => {
          Person.find({
          }).toSql().should.eql('select `Person`.* from `Person` order by `Person`.`id` asc limit 100')
        })
        it('limit & offset', () => {
          Person.find({
            limit: 2
          }).toSql().should.eql('select `Person`.* from `Person` order by `Person`.`id` asc limit 2')
          Person.find({
            offset: 2
          }).toSql().should.eql('select `Person`.* from `Person` order by `Person`.`id` asc limit 100 offset 2')
          Person.find({
            limit: 2, offset: 3
          }).toSql().should.eql('select `Person`.* from `Person` order by `Person`.`id` asc limit 2 offset 3')
        })
        it('count', async () => {
          const count = await Person.find({
            limit: 2, offset: 3,
            where: {
              'movies.id': { $gt: 1 },
              firstName: ['F07', 'F08', 'F09']
            }
          }).resultSize()
          count.should.be.eql(3)
        })
      })

      describe('where', () => {
        it('empty', () => {
          Person.find({
            where: {}
          }).toSql().should.eql('select `Person`.* from `Person` order by `Person`.`id` asc limit 100')
        })
        it('equal', () => {
          Person.find({
            where: { firstName: 'F08' }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` = \'F08\') order by `Person`.`id` asc limit 100')
          Person.find({
            where: { firstName: { '$equals': 'F08' } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` = \'F08\') order by `Person`.`id` asc limit 100')
        })
        it('custom operator $equalsLower', () => {
          Person.find({
            where: { firstName: { $equalsLower: 'F08' } }
          }).toSql().should.eql('select `Person`.* from `Person` where (LOWER(`Person`.`firstName`) = LOWER(\'F08\')) order by `Person`.`id` asc limit 100')
        })
        it('$gt $lt $gte $lte', () => {
          Person.find({
            where: { age: { '$gt': 10 } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`age` > 10) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { age: { '$lt': 60 } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`age` < 60) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { age: { '$gt': 10, '$lt': 60 } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`age` > 10 and `Person`.`age` < 60) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { age: { '$gte': 10, '$lte': 60 } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`age` >= 10 and `Person`.`age` <= 60) order by `Person`.`id` asc limit 100')
        })
        it('$between', () => {
          Person.find({
            where: { age: { '$between': [10, 60] } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`age` between 10 and 60) order by `Person`.`id` asc limit 100')
        })
        it('$in', async () => {
          Person.find({
            where: { firstName: { '$in': ['F08', 'F07'] } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` in (\'F08\', \'F07\')) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { firstName: ['F08', 'F07'] }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` in (\'F08\', \'F07\')) order by `Person`.`id` asc limit 100')
        })
        it('$exists', () => {
          Person.find({
            where: { firstName: { '$exists': true } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` is not null) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { firstName: { '$exists': false } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` is null) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { firstName: { '$or': [ { '$exists': false }, { '$equals': '' } ] } }
          }).toSql().should.eql('select `Person`.* from `Person` where (((((`Person`.`firstName` is null) or (`Person`.`firstName` = \'\'))))) order by `Person`.`id` asc limit 100')
          Person.find({
            where: { '$or': [ { firstName: { '$exists': false } }, { firstName: { '$equals': '' } } ] }
          }).toSql().should.eql('select `Person`.* from `Person` where (((`Person`.`firstName` is null) or (`Person`.`firstName` = \'\'))) order by `Person`.`id` asc limit 100')
        })
        it('$like', () => {
          Person.find({
            where: { firstName: { $like: 'F' } }
          }).toSql().should.eql('select `Person`.* from `Person` where (`Person`.`firstName` like \'F\') order by `Person`.`id` asc limit 100')
        })
        it('$or', () => {
          Person.find({
            where: { '$or': [ { firstName: 'F08' }, { age: { '$gt': 10, '$lt': 60 } } ] }
          }).toSql().should.eql('select `Person`.* from `Person` where (((`Person`.`firstName` = \'F08\') or (`Person`.`age` > 10 and `Person`.`age` < 60))) order by `Person`.`id` asc limit 100')
        })
      })

      describe('filter attributes', function() {
        it('or', async () => {
          Person.find({
            limit: 5, offset: 0,
            include: 'movies',
            where: {
              // age: { '$gt': 10 },
              // firstName: ['F05']
              // firstName: { '$in': ['1'] }
              // firstName: 'F05'
              '$or': [
                { age: { '$gt': 80 } },
                { firstName: 'F05',
                  'movies.id': { $gt: 1 },
                }
              ]
            }
          }).toSql().should.eql('select `Person`.* from `Person` inner join (select distinct `Person`.`id` from `Person` inner join `Person_Movie` as `movies_join` on `movies_join`.`actorId` = `Person`.`id` inner join `Movie` as `movies` on `movies_join`.`movieId` = `movies`.`id` where (((`Person`.`age` > 80) or (`Person`.`firstName` = \'F05\' and `movies`.`id` > 1)))) as `filter_query` on `Person`.`id` = `filter_query`.`id` order by `Person`.`id` asc limit 5')
        })
        it('tree filter', async () => {
        })
        it.skip('groupBy', async () => {
          const result = await buildCustomFilter(Movie, {
            groupBy: ['categoryId', 'seq'],
            // fields: ['categoryId', { sum: 'seq', alias: 'sumSeq' }]
            // fields: ['categoryId', 'seq'],
            measure: ['seq as sumSeq']
          })
          console.log('=======', result)
        })
        it('full feature', done => {
          Person.find({
            limit: 5, offset: 1,
            order: 'firstName desc, movies.id',
            fields: 'id,firstName as name, movies.id,movies.name,movies.category.*',
            where: {
              id: { $gt: 0 },
              'movies.id': { $gt: 0 },
              'parent.movies.id': { $gt: 0 }
            },
            include: {
              movies: {
                category: true,
                $where: {
                  id: { $lt: 45 }
                }
              }
            }
          }).then(result => {
            result.should.be.an.an('array')
            result.should.have.length(5);
            result[0].name.should.equal('F08');
            _.keys(result[0]).should.deep.equal(['id', 'name', 'movies']);
            _.forEach(result, person => {
              _.forEach(person.movies, movie => {
                (movie.id).should.be.lt(45)
                _.keys(movie).should.deep.equal(['id', 'name', 'category']);
              })
            })
            result.map(item => item.id).should.deep.equal([
              9,8,7,6,5
            ]);
            done();
          }).catch(done);
        });
      });
    });
  });
});
