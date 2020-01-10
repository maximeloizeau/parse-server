'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Types = undefined;
exports.addFunction = addFunction;
exports.addJob = addJob;
exports.addTrigger = addTrigger;
exports.addLiveQueryEventHandler = addLiveQueryEventHandler;
exports.removeFunction = removeFunction;
exports.removeTrigger = removeTrigger;
exports._unregisterAll = _unregisterAll;
exports.getTrigger = getTrigger;
exports.triggerExists = triggerExists;
exports.getFunction = getFunction;
exports.getJob = getJob;
exports.getJobs = getJobs;
exports.getValidator = getValidator;
exports.getRequestObject = getRequestObject;
exports.getRequestQueryObject = getRequestQueryObject;
exports.getResponseObject = getResponseObject;
exports.maybeRunAfterFindTrigger = maybeRunAfterFindTrigger;
exports.maybeRunQueryTrigger = maybeRunQueryTrigger;
exports.maybeRunTrigger = maybeRunTrigger;
exports.inflate = inflate;
exports.runLiveQueryEventHandlers = runLiveQueryEventHandlers;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _logger = require('./logger');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// triggers.js
const Types = exports.Types = {
  beforeSave: 'beforeSave',
  afterSave: 'afterSave',
  beforeDelete: 'beforeDelete',
  afterDelete: 'afterDelete',
  beforeFind: 'beforeFind',
  afterFind: 'afterFind'
};

const baseStore = function () {
  const Validators = {};
  const Functions = {};
  const Jobs = {};
  const LiveQuery = [];
  const Triggers = Object.keys(Types).reduce(function (base, key) {
    base[key] = {};
    return base;
  }, {});

  return Object.freeze({
    Functions,
    Jobs,
    Validators,
    Triggers,
    LiveQuery
  });
};

function validateClassNameForTriggers(className, type) {
  const restrictedClassNames = [];
  if (restrictedClassNames.indexOf(className) != -1) {
    throw `Triggers are not supported for ${className} class.`;
  }
  if (type == Types.beforeSave && className === '_PushStatus') {
    // _PushStatus uses undocumented nested key increment ops
    // allowing beforeSave would mess up the objects big time
    // TODO: Allow proper documented way of using nested increment ops
    throw 'Only afterSave is allowed on _PushStatus';
  }
  return className;
}

const _triggerStore = {};

function addFunction(functionName, handler, validationHandler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Functions[functionName] = handler;
  _triggerStore[applicationId].Validators[functionName] = validationHandler;
}

function addJob(jobName, handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Jobs[jobName] = handler;
}

function addTrigger(type, className, handler, applicationId) {
  validateClassNameForTriggers(className, type);
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Triggers[type][className] = handler;
}

function addLiveQueryEventHandler(handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].LiveQuery.push(handler);
}

function removeFunction(functionName, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Functions[functionName];
}

function removeTrigger(type, className, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Triggers[type][className];
}

function _unregisterAll() {
  Object.keys(_triggerStore).forEach(appId => delete _triggerStore[appId]);
}

function getTrigger(className, triggerType, applicationId) {
  if (!applicationId) {
    throw "Missing ApplicationID";
  }
  var manager = _triggerStore[applicationId];
  if (manager && manager.Triggers && manager.Triggers[triggerType] && manager.Triggers[triggerType][className]) {
    return manager.Triggers[triggerType][className];
  }
  return undefined;
}

function triggerExists(className, type, applicationId) {
  return getTrigger(className, type, applicationId) != undefined;
}

function getFunction(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Functions) {
    return manager.Functions[functionName];
  }
  return undefined;
}

function getJob(jobName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs[jobName];
  }
  return undefined;
}

function getJobs(applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs;
  }
  return undefined;
}

function getValidator(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Validators) {
    return manager.Validators[functionName];
  }
  return undefined;
}

function getRequestObject(triggerType, auth, parseObject, originalParseObject, config) {
  var request = {
    triggerName: triggerType,
    object: parseObject,
    master: false,
    log: config.loggerController,
    headers: config.headers,
    ip: config.ip
  };

  if (originalParseObject) {
    request.original = originalParseObject;
  }

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

function getRequestQueryObject(triggerType, auth, query, count, config, isGet) {
  isGet = !!isGet;

  var request = {
    triggerName: triggerType,
    query,
    master: false,
    count,
    log: config.loggerController,
    isGet,
    headers: config.headers,
    ip: config.ip
  };

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

// Creates the response object, and uses the request object to pass data
// The API will call this with REST API formatted objects, this will
// transform them to Parse.Object instances expected by Cloud Code.
// Any changes made to the object in a beforeSave will be included.
function getResponseObject(request, resolve, reject) {
  return {
    success: function (response) {
      if (request.triggerName === Types.afterFind) {
        if (!response) {
          response = request.objects;
        }
        response = response.map(object => {
          return object.toJSON();
        });
        return resolve(response);
      }
      // Use the JSON response
      if (response && !request.object.equals(response) && request.triggerName === Types.beforeSave) {
        return resolve(response);
      }
      response = {};
      if (request.triggerName === Types.beforeSave) {
        response['object'] = request.object._getSaveJSON();
      }
      return resolve(response);
    },
    error: function (code, message) {
      if (!message) {
        if (code instanceof _node2.default.Error) {
          return reject(code);
        }
        message = code;
        code = _node2.default.Error.SCRIPT_FAILED;
      }
      var scriptError = new _node2.default.Error(code, message);
      return reject(scriptError);
    }
  };
}

function userIdForLog(auth) {
  return auth && auth.user ? auth.user.id : undefined;
}

function logTriggerAfterHook(triggerType, className, input, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerSuccessBeforeHook(triggerType, className, input, result, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  const cleanResult = _logger.logger.truncateLogMessage(JSON.stringify(result));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Result: ${cleanResult}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerErrorBeforeHook(triggerType, className, input, auth, error) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.error(`${triggerType} failed for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Error: ${JSON.stringify(error)}`, {
    className,
    triggerType,
    error,
    user: userIdForLog(auth)
  });
}

function maybeRunAfterFindTrigger(triggerType, auth, className, objects, config) {
  return new Promise((resolve, reject) => {
    const trigger = getTrigger(className, triggerType, config.applicationId);
    if (!trigger) {
      return resolve();
    }
    const request = getRequestObject(triggerType, auth, null, null, config);
    const response = getResponseObject(request, object => {
      resolve(object);
    }, error => {
      reject(error);
    });
    logTriggerSuccessBeforeHook(triggerType, className, 'AfterFind', JSON.stringify(objects), auth);
    request.objects = objects.map(object => {
      //setting the class name to transform into parse object
      object.className = className;
      return _node2.default.Object.fromJSON(object);
    });
    const triggerPromise = trigger(request, response);
    if (triggerPromise && typeof triggerPromise.then === "function") {
      return triggerPromise.then(promiseResults => {
        if (promiseResults) {
          resolve(promiseResults);
        } else {
          return reject(new _node2.default.Error(_node2.default.Error.SCRIPT_FAILED, "AfterFind expect results to be returned in the promise"));
        }
      });
    }
  }).then(results => {
    logTriggerAfterHook(triggerType, className, JSON.stringify(results), auth);
    return results;
  });
}

function maybeRunQueryTrigger(triggerType, className, restWhere, restOptions, config, auth, isGet) {
  const trigger = getTrigger(className, triggerType, config.applicationId);
  if (!trigger) {
    return Promise.resolve({
      restWhere,
      restOptions
    });
  }

  const parseQuery = new _node2.default.Query(className);
  if (restWhere) {
    parseQuery._where = restWhere;
  }
  let count = false;
  if (restOptions) {
    if (restOptions.include && restOptions.include.length > 0) {
      parseQuery._include = restOptions.include.split(',');
    }
    if (restOptions.skip) {
      parseQuery._skip = restOptions.skip;
    }
    if (restOptions.limit) {
      parseQuery._limit = restOptions.limit;
    }
    count = !!restOptions.count;
  }
  const requestObject = getRequestQueryObject(triggerType, auth, parseQuery, count, config, isGet);
  return Promise.resolve().then(() => {
    return trigger(requestObject);
  }).then(result => {
    let queryResult = parseQuery;
    if (result && result instanceof _node2.default.Query) {
      queryResult = result;
    }
    const jsonQuery = queryResult.toJSON();
    if (jsonQuery.where) {
      restWhere = jsonQuery.where;
    }
    if (jsonQuery.limit) {
      restOptions = restOptions || {};
      restOptions.limit = jsonQuery.limit;
    }
    if (jsonQuery.skip) {
      restOptions = restOptions || {};
      restOptions.skip = jsonQuery.skip;
    }
    if (jsonQuery.include) {
      restOptions = restOptions || {};
      restOptions.include = jsonQuery.include;
    }
    if (jsonQuery.keys) {
      restOptions = restOptions || {};
      restOptions.keys = jsonQuery.keys;
    }
    if (jsonQuery.order) {
      restOptions = restOptions || {};
      restOptions.order = jsonQuery.order;
    }
    if (requestObject.readPreference) {
      restOptions = restOptions || {};
      restOptions.readPreference = requestObject.readPreference;
    }
    if (requestObject.includeReadPreference) {
      restOptions = restOptions || {};
      restOptions.includeReadPreference = requestObject.includeReadPreference;
    }
    if (requestObject.subqueryReadPreference) {
      restOptions = restOptions || {};
      restOptions.subqueryReadPreference = requestObject.subqueryReadPreference;
    }
    return {
      restWhere,
      restOptions
    };
  }, err => {
    if (typeof err === 'string') {
      throw new _node2.default.Error(1, err);
    } else {
      throw err;
    }
  });
}

// To be used as part of the promise chain when saving/deleting an object
// Will resolve successfully if no trigger is configured
// Resolves to an object, empty or containing an object key. A beforeSave
// trigger will set the object key to the rest format object to save.
// originalParseObject is optional, we only need that for before/afterSave functions
function maybeRunTrigger(triggerType, auth, parseObject, originalParseObject, config) {
  if (!parseObject) {
    return Promise.resolve({});
  }
  return new Promise(function (resolve, reject) {
    var trigger = getTrigger(parseObject.className, triggerType, config.applicationId);
    if (!trigger) return resolve();
    var request = getRequestObject(triggerType, auth, parseObject, originalParseObject, config);
    var response = getResponseObject(request, object => {
      logTriggerSuccessBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), object, auth);
      resolve(object);
    }, error => {
      logTriggerErrorBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), auth, error);
      reject(error);
    });
    // Force the current Parse app before the trigger
    _node2.default.applicationId = config.applicationId;
    _node2.default.javascriptKey = config.javascriptKey || '';
    _node2.default.masterKey = config.masterKey;

    // AfterSave and afterDelete triggers can return a promise, which if they
    // do, needs to be resolved before this promise is resolved,
    // so trigger execution is synced with RestWrite.execute() call.
    // If triggers do not return a promise, they can run async code parallel
    // to the RestWrite.execute() call.
    var triggerPromise = trigger(request, response);
    if (triggerType === Types.afterSave || triggerType === Types.afterDelete) {
      logTriggerAfterHook(triggerType, parseObject.className, parseObject.toJSON(), auth);
      if (triggerPromise && typeof triggerPromise.then === "function") {
        return triggerPromise.then(resolve, resolve);
      } else {
        return resolve();
      }
    }
  });
}

// Converts a REST-format object to a Parse.Object
// data is either className or an object
function inflate(data, restObject) {
  var copy = typeof data == 'object' ? data : { className: data };
  for (var key in restObject) {
    copy[key] = restObject[key];
  }
  return _node2.default.Object.fromJSON(copy);
}

function runLiveQueryEventHandlers(data, applicationId = _node2.default.applicationId) {
  if (!_triggerStore || !_triggerStore[applicationId] || !_triggerStore[applicationId].LiveQuery) {
    return;
  }
  _triggerStore[applicationId].LiveQuery.forEach(handler => handler(data));
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy90cmlnZ2Vycy5qcyJdLCJuYW1lcyI6WyJhZGRGdW5jdGlvbiIsImFkZEpvYiIsImFkZFRyaWdnZXIiLCJhZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIiLCJyZW1vdmVGdW5jdGlvbiIsInJlbW92ZVRyaWdnZXIiLCJfdW5yZWdpc3RlckFsbCIsImdldFRyaWdnZXIiLCJ0cmlnZ2VyRXhpc3RzIiwiZ2V0RnVuY3Rpb24iLCJnZXRKb2IiLCJnZXRKb2JzIiwiZ2V0VmFsaWRhdG9yIiwiZ2V0UmVxdWVzdE9iamVjdCIsImdldFJlcXVlc3RRdWVyeU9iamVjdCIsImdldFJlc3BvbnNlT2JqZWN0IiwibWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyIiwibWF5YmVSdW5RdWVyeVRyaWdnZXIiLCJtYXliZVJ1blRyaWdnZXIiLCJpbmZsYXRlIiwicnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyIsIlR5cGVzIiwiYmVmb3JlU2F2ZSIsImFmdGVyU2F2ZSIsImJlZm9yZURlbGV0ZSIsImFmdGVyRGVsZXRlIiwiYmVmb3JlRmluZCIsImFmdGVyRmluZCIsImJhc2VTdG9yZSIsIlZhbGlkYXRvcnMiLCJGdW5jdGlvbnMiLCJKb2JzIiwiTGl2ZVF1ZXJ5IiwiVHJpZ2dlcnMiLCJPYmplY3QiLCJrZXlzIiwicmVkdWNlIiwiYmFzZSIsImtleSIsImZyZWV6ZSIsInZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMiLCJjbGFzc05hbWUiLCJ0eXBlIiwicmVzdHJpY3RlZENsYXNzTmFtZXMiLCJpbmRleE9mIiwiX3RyaWdnZXJTdG9yZSIsImZ1bmN0aW9uTmFtZSIsImhhbmRsZXIiLCJ2YWxpZGF0aW9uSGFuZGxlciIsImFwcGxpY2F0aW9uSWQiLCJQYXJzZSIsImpvYk5hbWUiLCJwdXNoIiwiZm9yRWFjaCIsImFwcElkIiwidHJpZ2dlclR5cGUiLCJtYW5hZ2VyIiwidW5kZWZpbmVkIiwiYXV0aCIsInBhcnNlT2JqZWN0Iiwib3JpZ2luYWxQYXJzZU9iamVjdCIsImNvbmZpZyIsInJlcXVlc3QiLCJ0cmlnZ2VyTmFtZSIsIm9iamVjdCIsIm1hc3RlciIsImxvZyIsImxvZ2dlckNvbnRyb2xsZXIiLCJoZWFkZXJzIiwiaXAiLCJvcmlnaW5hbCIsImlzTWFzdGVyIiwidXNlciIsImluc3RhbGxhdGlvbklkIiwicXVlcnkiLCJjb3VudCIsImlzR2V0IiwicmVzb2x2ZSIsInJlamVjdCIsInN1Y2Nlc3MiLCJyZXNwb25zZSIsIm9iamVjdHMiLCJtYXAiLCJ0b0pTT04iLCJlcXVhbHMiLCJfZ2V0U2F2ZUpTT04iLCJlcnJvciIsImNvZGUiLCJtZXNzYWdlIiwiRXJyb3IiLCJTQ1JJUFRfRkFJTEVEIiwic2NyaXB0RXJyb3IiLCJ1c2VySWRGb3JMb2ciLCJpZCIsImxvZ1RyaWdnZXJBZnRlckhvb2siLCJpbnB1dCIsImNsZWFuSW5wdXQiLCJsb2dnZXIiLCJ0cnVuY2F0ZUxvZ01lc3NhZ2UiLCJKU09OIiwic3RyaW5naWZ5IiwiaW5mbyIsImxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayIsInJlc3VsdCIsImNsZWFuUmVzdWx0IiwibG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayIsIlByb21pc2UiLCJ0cmlnZ2VyIiwiZnJvbUpTT04iLCJ0cmlnZ2VyUHJvbWlzZSIsInRoZW4iLCJwcm9taXNlUmVzdWx0cyIsInJlc3VsdHMiLCJyZXN0V2hlcmUiLCJyZXN0T3B0aW9ucyIsInBhcnNlUXVlcnkiLCJRdWVyeSIsIl93aGVyZSIsImluY2x1ZGUiLCJsZW5ndGgiLCJfaW5jbHVkZSIsInNwbGl0Iiwic2tpcCIsIl9za2lwIiwibGltaXQiLCJfbGltaXQiLCJyZXF1ZXN0T2JqZWN0IiwicXVlcnlSZXN1bHQiLCJqc29uUXVlcnkiLCJ3aGVyZSIsIm9yZGVyIiwicmVhZFByZWZlcmVuY2UiLCJpbmNsdWRlUmVhZFByZWZlcmVuY2UiLCJzdWJxdWVyeVJlYWRQcmVmZXJlbmNlIiwiZXJyIiwiamF2YXNjcmlwdEtleSIsIm1hc3RlcktleSIsImRhdGEiLCJyZXN0T2JqZWN0IiwiY29w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RUFBOEV6QixJQUE5RTtBQUNBLFVBQUdtRCxrQkFBa0IsT0FBT0EsZUFBZUMsSUFBdEIsS0FBK0IsVUFBcEQsRUFBZ0U7QUFDOUQsZUFBT0QsZUFBZUMsSUFBZixDQUFvQmpDLE9BQXBCLEVBQTZCQSxPQUE3QixDQUFQO0FBQ0QsT0FGRCxNQUdLO0FBQ0gsZUFBT0EsU0FBUDtBQUNEO0FBQ0Y7QUFDRixHQWxDTSxDQUFQO0FBbUNEOztBQUVEO0FBQ0E7QUFDTyxTQUFTMUQsT0FBVCxDQUFpQnNILElBQWpCLEVBQXVCQyxVQUF2QixFQUFtQztBQUN4QyxNQUFJQyxPQUFPLE9BQU9GLElBQVAsSUFBZSxRQUFmLEdBQTBCQSxJQUExQixHQUFpQyxFQUFDaEcsV0FBV2dHLElBQVosRUFBNUM7QUFDQSxPQUFLLElBQUluRyxHQUFULElBQWdCb0csVUFBaEIsRUFBNEI7QUFDMUJDLFNBQUtyRyxHQUFMLElBQVlvRyxXQUFXcEcsR0FBWCxDQUFaO0FBQ0Q7QUFDRCxTQUFPWSxlQUFNaEIsTUFBTixDQUFhMEUsUUFBYixDQUFzQitCLElBQXRCLENBQVA7QUFDRDs7QUFFTSxTQUFTdkgseUJBQVQsQ0FBbUNxSCxJQUFuQyxFQUF5Q3hGLGdCQUFnQkMsZUFBTUQsYUFBL0QsRUFBOEU7QUFDbkYsTUFBSSxDQUFDSixhQUFELElBQWtCLENBQUNBLGNBQWNJLGFBQWQsQ0FBbkIsSUFBbUQsQ0FBQ0osY0FBY0ksYUFBZCxFQUE2QmpCLFNBQXJGLEVBQWdHO0FBQUU7QUFBUztBQUMzR2EsZ0JBQWNJLGFBQWQsRUFBNkJqQixTQUE3QixDQUF1Q3FCLE9BQXZDLENBQWdETixPQUFELElBQWFBLFFBQVEwRixJQUFSLENBQTVEO0FBQ0QiLCJmaWxlIjoidHJpZ2dlcnMuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyB0cmlnZ2Vycy5qc1xuaW1wb3J0IFBhcnNlICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXInO1xuXG5leHBvcnQgY29uc3QgVHlwZXMgPSB7XG4gIGJlZm9yZVNhdmU6ICdiZWZvcmVTYXZlJyxcbiAgYWZ0ZXJTYXZlOiAnYWZ0ZXJTYXZlJyxcbiAgYmVmb3JlRGVsZXRlOiAnYmVmb3JlRGVsZXRlJyxcbiAgYWZ0ZXJEZWxldGU6ICdhZnRlckRlbGV0ZScsXG4gIGJlZm9yZUZpbmQ6ICdiZWZvcmVGaW5kJyxcbiAgYWZ0ZXJGaW5kOiAnYWZ0ZXJGaW5kJ1xufTtcblxuY29uc3QgYmFzZVN0b3JlID0gZnVuY3Rpb24oKSB7XG4gIGNvbnN0IFZhbGlkYXRvcnMgPSB7fTtcbiAgY29uc3QgRnVuY3Rpb25zID0ge307XG4gIGNvbnN0IEpvYnMgPSB7fTtcbiAgY29uc3QgTGl2ZVF1ZXJ5ID0gW107XG4gIGNvbnN0IFRyaWdnZXJzID0gT2JqZWN0LmtleXMoVHlwZXMpLnJlZHVjZShmdW5jdGlvbihiYXNlLCBrZXkpe1xuICAgIGJhc2Vba2V5XSA9IHt9O1xuICAgIHJldHVybiBiYXNlO1xuICB9LCB7fSk7XG5cbiAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgIEZ1bmN0aW9ucyxcbiAgICBKb2JzLFxuICAgIFZhbGlkYXRvcnMsXG4gICAgVHJpZ2dlcnMsXG4gICAgTGl2ZVF1ZXJ5LFxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIHZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMoY2xhc3NOYW1lLCB0eXBlKSB7XG4gIGNvbnN0IHJlc3RyaWN0ZWRDbGFzc05hbWVzID0gW107XG4gIGlmIChyZXN0cmljdGVkQ2xhc3NOYW1lcy5pbmRleE9mKGNsYXNzTmFtZSkgIT0gLTEpIHtcbiAgICB0aHJvdyBgVHJpZ2dlcnMgYXJlIG5vdCBzdXBwb3J0ZWQgZm9yICR7Y2xhc3NOYW1lfSBjbGFzcy5gO1xuICB9XG4gIGlmICh0eXBlID09IFR5cGVzLmJlZm9yZVNhdmUgJiYgY2xhc3NOYW1lID09PSAnX1B1c2hTdGF0dXMnKSB7XG4gICAgLy8gX1B1c2hTdGF0dXMgdXNlcyB1bmRvY3VtZW50ZWQgbmVzdGVkIGtleSBpbmNyZW1lbnQgb3BzXG4gICAgLy8gYWxsb3dpbmcgYmVmb3JlU2F2ZSB3b3VsZCBtZXNzIHVwIHRoZSBvYmplY3RzIGJpZyB0aW1lXG4gICAgLy8gVE9ETzogQWxsb3cgcHJvcGVyIGRvY3VtZW50ZWQgd2F5IG9mIHVzaW5nIG5lc3RlZCBpbmNyZW1lbnQgb3BzXG4gICAgdGhyb3cgJ09ubHkgYWZ0ZXJTYXZlIGlzIGFsbG93ZWQgb24gX1B1c2hTdGF0dXMnO1xuICB9XG4gIHJldHVybiBjbGFzc05hbWU7XG59XG5cbmNvbnN0IF90cmlnZ2VyU3RvcmUgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEZ1bmN0aW9uKGZ1bmN0aW9uTmFtZSwgaGFuZGxlciwgdmFsaWRhdGlvbkhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSA9ICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8IGJhc2VTdG9yZSgpO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkZ1bmN0aW9uc1tmdW5jdGlvbk5hbWVdID0gaGFuZGxlcjtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5WYWxpZGF0b3JzW2Z1bmN0aW9uTmFtZV0gPSB2YWxpZGF0aW9uSGFuZGxlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEpvYihqb2JOYW1lLCBoYW5kbGVyLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gPSAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSB8fCBiYXNlU3RvcmUoKTtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5Kb2JzW2pvYk5hbWVdID0gaGFuZGxlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZFRyaWdnZXIodHlwZSwgY2xhc3NOYW1lLCBoYW5kbGVyLCBhcHBsaWNhdGlvbklkKSB7XG4gIHZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMoY2xhc3NOYW1lLCB0eXBlKTtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSA9ICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8IGJhc2VTdG9yZSgpO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLlRyaWdnZXJzW3R5cGVdW2NsYXNzTmFtZV0gPSBoYW5kbGVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVyKGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSA9ICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8IGJhc2VTdG9yZSgpO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkxpdmVRdWVyeS5wdXNoKGhhbmRsZXIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIGRlbGV0ZSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkZ1bmN0aW9uc1tmdW5jdGlvbk5hbWVdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVUcmlnZ2VyKHR5cGUsIGNsYXNzTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBkZWxldGUgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5UcmlnZ2Vyc1t0eXBlXVtjbGFzc05hbWVdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBfdW5yZWdpc3RlckFsbCgpIHtcbiAgT2JqZWN0LmtleXMoX3RyaWdnZXJTdG9yZSkuZm9yRWFjaChhcHBJZCA9PiBkZWxldGUgX3RyaWdnZXJTdG9yZVthcHBJZF0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VHJpZ2dlcihjbGFzc05hbWUsIHRyaWdnZXJUeXBlLCBhcHBsaWNhdGlvbklkKSB7XG4gIGlmICghYXBwbGljYXRpb25JZCkge1xuICAgIHRocm93IFwiTWlzc2luZyBBcHBsaWNhdGlvbklEXCI7XG4gIH1cbiAgdmFyIG1hbmFnZXIgPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdXG4gIGlmIChtYW5hZ2VyXG4gICAgJiYgbWFuYWdlci5UcmlnZ2Vyc1xuICAgICYmIG1hbmFnZXIuVHJpZ2dlcnNbdHJpZ2dlclR5cGVdXG4gICAgJiYgbWFuYWdlci5UcmlnZ2Vyc1t0cmlnZ2VyVHlwZV1bY2xhc3NOYW1lXSkge1xuICAgIHJldHVybiBtYW5hZ2VyLlRyaWdnZXJzW3RyaWdnZXJUeXBlXVtjbGFzc05hbWVdO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0cmlnZ2VyRXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nLCB0eXBlOiBzdHJpbmcsIGFwcGxpY2F0aW9uSWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gKGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0eXBlLCBhcHBsaWNhdGlvbklkKSAhPSB1bmRlZmluZWQpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIHZhciBtYW5hZ2VyID0gX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXTtcbiAgaWYgKG1hbmFnZXIgJiYgbWFuYWdlci5GdW5jdGlvbnMpIHtcbiAgICByZXR1cm4gbWFuYWdlci5GdW5jdGlvbnNbZnVuY3Rpb25OYW1lXTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0Sm9iKGpvYk5hbWUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgdmFyIG1hbmFnZXIgPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdO1xuICBpZiAobWFuYWdlciAmJiBtYW5hZ2VyLkpvYnMpIHtcbiAgICByZXR1cm4gbWFuYWdlci5Kb2JzW2pvYk5hbWVdO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRKb2JzKGFwcGxpY2F0aW9uSWQpIHtcbiAgdmFyIG1hbmFnZXIgPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdO1xuICBpZiAobWFuYWdlciAmJiBtYW5hZ2VyLkpvYnMpIHtcbiAgICByZXR1cm4gbWFuYWdlci5Kb2JzO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFZhbGlkYXRvcihmdW5jdGlvbk5hbWUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgdmFyIG1hbmFnZXIgPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdO1xuICBpZiAobWFuYWdlciAmJiBtYW5hZ2VyLlZhbGlkYXRvcnMpIHtcbiAgICByZXR1cm4gbWFuYWdlci5WYWxpZGF0b3JzW2Z1bmN0aW9uTmFtZV07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlcXVlc3RPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIHBhcnNlT2JqZWN0LCBvcmlnaW5hbFBhcnNlT2JqZWN0LCBjb25maWcpIHtcbiAgdmFyIHJlcXVlc3QgPSB7XG4gICAgdHJpZ2dlck5hbWU6IHRyaWdnZXJUeXBlLFxuICAgIG9iamVjdDogcGFyc2VPYmplY3QsXG4gICAgbWFzdGVyOiBmYWxzZSxcbiAgICBsb2c6IGNvbmZpZy5sb2dnZXJDb250cm9sbGVyLFxuICAgIGhlYWRlcnM6IGNvbmZpZy5oZWFkZXJzLFxuICAgIGlwOiBjb25maWcuaXAsXG4gIH07XG5cbiAgaWYgKG9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICByZXF1ZXN0Lm9yaWdpbmFsID0gb3JpZ2luYWxQYXJzZU9iamVjdDtcbiAgfVxuXG4gIGlmICghYXV0aCkge1xuICAgIHJldHVybiByZXF1ZXN0O1xuICB9XG4gIGlmIChhdXRoLmlzTWFzdGVyKSB7XG4gICAgcmVxdWVzdFsnbWFzdGVyJ10gPSB0cnVlO1xuICB9XG4gIGlmIChhdXRoLnVzZXIpIHtcbiAgICByZXF1ZXN0Wyd1c2VyJ10gPSBhdXRoLnVzZXI7XG4gIH1cbiAgaWYgKGF1dGguaW5zdGFsbGF0aW9uSWQpIHtcbiAgICByZXF1ZXN0WydpbnN0YWxsYXRpb25JZCddID0gYXV0aC5pbnN0YWxsYXRpb25JZDtcbiAgfVxuICByZXR1cm4gcmVxdWVzdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlcXVlc3RRdWVyeU9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgcXVlcnksIGNvdW50LCBjb25maWcsIGlzR2V0KSB7XG4gIGlzR2V0ID0gISFpc0dldDtcblxuICB2YXIgcmVxdWVzdCA9IHtcbiAgICB0cmlnZ2VyTmFtZTogdHJpZ2dlclR5cGUsXG4gICAgcXVlcnksXG4gICAgbWFzdGVyOiBmYWxzZSxcbiAgICBjb3VudCxcbiAgICBsb2c6IGNvbmZpZy5sb2dnZXJDb250cm9sbGVyLFxuICAgIGlzR2V0LFxuICAgIGhlYWRlcnM6IGNvbmZpZy5oZWFkZXJzLFxuICAgIGlwOiBjb25maWcuaXAsXG4gIH07XG5cbiAgaWYgKCFhdXRoKSB7XG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cbiAgaWYgKGF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXF1ZXN0WydtYXN0ZXInXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGgudXNlcikge1xuICAgIHJlcXVlc3RbJ3VzZXInXSA9IGF1dGgudXNlcjtcbiAgfVxuICBpZiAoYXV0aC5pbnN0YWxsYXRpb25JZCkge1xuICAgIHJlcXVlc3RbJ2luc3RhbGxhdGlvbklkJ10gPSBhdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG4gIHJldHVybiByZXF1ZXN0O1xufVxuXG4vLyBDcmVhdGVzIHRoZSByZXNwb25zZSBvYmplY3QsIGFuZCB1c2VzIHRoZSByZXF1ZXN0IG9iamVjdCB0byBwYXNzIGRhdGFcbi8vIFRoZSBBUEkgd2lsbCBjYWxsIHRoaXMgd2l0aCBSRVNUIEFQSSBmb3JtYXR0ZWQgb2JqZWN0cywgdGhpcyB3aWxsXG4vLyB0cmFuc2Zvcm0gdGhlbSB0byBQYXJzZS5PYmplY3QgaW5zdGFuY2VzIGV4cGVjdGVkIGJ5IENsb3VkIENvZGUuXG4vLyBBbnkgY2hhbmdlcyBtYWRlIHRvIHRoZSBvYmplY3QgaW4gYSBiZWZvcmVTYXZlIHdpbGwgYmUgaW5jbHVkZWQuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVzcG9uc2VPYmplY3QocmVxdWVzdCwgcmVzb2x2ZSwgcmVqZWN0KSB7XG4gIHJldHVybiB7XG4gICAgc3VjY2VzczogZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgIGlmIChyZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5hZnRlckZpbmQpIHtcbiAgICAgICAgaWYoIXJlc3BvbnNlKXtcbiAgICAgICAgICByZXNwb25zZSA9IHJlcXVlc3Qub2JqZWN0cztcbiAgICAgICAgfVxuICAgICAgICByZXNwb25zZSA9IHJlc3BvbnNlLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgIHJldHVybiBvYmplY3QudG9KU09OKCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgICB9XG4gICAgICAvLyBVc2UgdGhlIEpTT04gcmVzcG9uc2VcbiAgICAgIGlmIChyZXNwb25zZSAmJiAhcmVxdWVzdC5vYmplY3QuZXF1YWxzKHJlc3BvbnNlKVxuICAgICAgICAgICYmIHJlcXVlc3QudHJpZ2dlck5hbWUgPT09IFR5cGVzLmJlZm9yZVNhdmUpIHtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgfVxuICAgICAgcmVzcG9uc2UgPSB7fTtcbiAgICAgIGlmIChyZXF1ZXN0LnRyaWdnZXJOYW1lID09PSBUeXBlcy5iZWZvcmVTYXZlKSB7XG4gICAgICAgIHJlc3BvbnNlWydvYmplY3QnXSA9IHJlcXVlc3Qub2JqZWN0Ll9nZXRTYXZlSlNPTigpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc29sdmUocmVzcG9uc2UpO1xuICAgIH0sXG4gICAgZXJyb3I6IGZ1bmN0aW9uKGNvZGUsIG1lc3NhZ2UpIHtcbiAgICAgIGlmICghbWVzc2FnZSkge1xuICAgICAgICBpZiAoY29kZSBpbnN0YW5jZW9mIFBhcnNlLkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChjb2RlKVxuICAgICAgICB9XG4gICAgICAgIG1lc3NhZ2UgPSBjb2RlO1xuICAgICAgICBjb2RlID0gUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRDtcbiAgICAgIH1cbiAgICAgIHZhciBzY3JpcHRFcnJvciA9IG5ldyBQYXJzZS5FcnJvcihjb2RlLCBtZXNzYWdlKTtcbiAgICAgIHJldHVybiByZWplY3Qoc2NyaXB0RXJyb3IpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiB1c2VySWRGb3JMb2coYXV0aCkge1xuICByZXR1cm4gKGF1dGggJiYgYXV0aC51c2VyKSA/IGF1dGgudXNlci5pZCA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gbG9nVHJpZ2dlckFmdGVySG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCBpbnB1dCwgYXV0aCkge1xuICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShpbnB1dCkpO1xuICBsb2dnZXIuaW5mbyhgJHt0cmlnZ2VyVHlwZX0gdHJpZ2dlcmVkIGZvciAke2NsYXNzTmFtZX0gZm9yIHVzZXIgJHt1c2VySWRGb3JMb2coYXV0aCl9OlxcbiAgSW5wdXQ6ICR7Y2xlYW5JbnB1dH1gLCB7XG4gICAgY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJUeXBlLFxuICAgIHVzZXI6IHVzZXJJZEZvckxvZyhhdXRoKVxuICB9KTtcbn1cblxuZnVuY3Rpb24gbG9nVHJpZ2dlclN1Y2Nlc3NCZWZvcmVIb29rKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsIGlucHV0LCByZXN1bHQsIGF1dGgpIHtcbiAgY29uc3QgY2xlYW5JbnB1dCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoaW5wdXQpKTtcbiAgY29uc3QgY2xlYW5SZXN1bHQgPSBsb2dnZXIudHJ1bmNhdGVMb2dNZXNzYWdlKEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICBsb2dnZXIuaW5mbyhgJHt0cmlnZ2VyVHlwZX0gdHJpZ2dlcmVkIGZvciAke2NsYXNzTmFtZX0gZm9yIHVzZXIgJHt1c2VySWRGb3JMb2coYXV0aCl9OlxcbiAgSW5wdXQ6ICR7Y2xlYW5JbnB1dH1cXG4gIFJlc3VsdDogJHtjbGVhblJlc3VsdH1gLCB7XG4gICAgY2xhc3NOYW1lLFxuICAgIHRyaWdnZXJUeXBlLFxuICAgIHVzZXI6IHVzZXJJZEZvckxvZyhhdXRoKVxuICB9KTtcbn1cblxuZnVuY3Rpb24gbG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCBpbnB1dCwgYXV0aCwgZXJyb3IpIHtcbiAgY29uc3QgY2xlYW5JbnB1dCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkoaW5wdXQpKTtcbiAgbG9nZ2VyLmVycm9yKGAke3RyaWdnZXJUeXBlfSBmYWlsZWQgZm9yICR7Y2xhc3NOYW1lfSBmb3IgdXNlciAke3VzZXJJZEZvckxvZyhhdXRoKX06XFxuICBJbnB1dDogJHtjbGVhbklucHV0fVxcbiAgRXJyb3I6ICR7SlNPTi5zdHJpbmdpZnkoZXJyb3IpfWAsIHtcbiAgICBjbGFzc05hbWUsXG4gICAgdHJpZ2dlclR5cGUsXG4gICAgZXJyb3IsXG4gICAgdXNlcjogdXNlcklkRm9yTG9nKGF1dGgpXG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyKHRyaWdnZXJUeXBlLCBhdXRoLCBjbGFzc05hbWUsIG9iamVjdHMsIGNvbmZpZykge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHRyaWdnZXIgPSBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgICBpZiAoIXRyaWdnZXIpIHtcbiAgICAgIHJldHVybiByZXNvbHZlKCk7XG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3QgPSBnZXRSZXF1ZXN0T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBudWxsLCBudWxsLCBjb25maWcpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gZ2V0UmVzcG9uc2VPYmplY3QocmVxdWVzdCxcbiAgICAgIG9iamVjdCA9PiB7XG4gICAgICAgIHJlc29sdmUob2JqZWN0KTtcbiAgICAgIH0sXG4gICAgICBlcnJvciA9PiB7XG4gICAgICAgIHJlamVjdChlcnJvcik7XG4gICAgICB9KTtcbiAgICBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgJ0FmdGVyRmluZCcsIEpTT04uc3RyaW5naWZ5KG9iamVjdHMpLCBhdXRoKTtcbiAgICByZXF1ZXN0Lm9iamVjdHMgPSBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgLy9zZXR0aW5nIHRoZSBjbGFzcyBuYW1lIHRvIHRyYW5zZm9ybSBpbnRvIHBhcnNlIG9iamVjdFxuICAgICAgb2JqZWN0LmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgICAgIHJldHVybiBQYXJzZS5PYmplY3QuZnJvbUpTT04ob2JqZWN0KTtcbiAgICB9KTtcbiAgICBjb25zdCB0cmlnZ2VyUHJvbWlzZSA9IHRyaWdnZXIocmVxdWVzdCwgcmVzcG9uc2UpO1xuICAgIGlmICh0cmlnZ2VyUHJvbWlzZSAmJiB0eXBlb2YgdHJpZ2dlclByb21pc2UudGhlbiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdHJpZ2dlclByb21pc2UudGhlbihwcm9taXNlUmVzdWx0cyA9PiB7XG4gICAgICAgIGlmKHByb21pc2VSZXN1bHRzKSB7XG4gICAgICAgICAgcmVzb2x2ZShwcm9taXNlUmVzdWx0cyk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgIHJldHVybiByZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlNDUklQVF9GQUlMRUQsIFwiQWZ0ZXJGaW5kIGV4cGVjdCByZXN1bHRzIHRvIGJlIHJldHVybmVkIGluIHRoZSBwcm9taXNlXCIpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KS50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgbG9nVHJpZ2dlckFmdGVySG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCBKU09OLnN0cmluZ2lmeShyZXN1bHRzKSwgYXV0aCk7XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWF5YmVSdW5RdWVyeVRyaWdnZXIodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgcmVzdFdoZXJlLCByZXN0T3B0aW9ucywgY29uZmlnLCBhdXRoLCBpc0dldCkge1xuICBjb25zdCB0cmlnZ2VyID0gZ2V0VHJpZ2dlcihjbGFzc05hbWUsIHRyaWdnZXJUeXBlLCBjb25maWcuYXBwbGljYXRpb25JZCk7XG4gIGlmICghdHJpZ2dlcikge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgcmVzdFdoZXJlLFxuICAgICAgcmVzdE9wdGlvbnNcbiAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IHBhcnNlUXVlcnkgPSBuZXcgUGFyc2UuUXVlcnkoY2xhc3NOYW1lKTtcbiAgaWYgKHJlc3RXaGVyZSkge1xuICAgIHBhcnNlUXVlcnkuX3doZXJlID0gcmVzdFdoZXJlO1xuICB9XG4gIGxldCBjb3VudCA9IGZhbHNlO1xuICBpZiAocmVzdE9wdGlvbnMpIHtcbiAgICBpZiAocmVzdE9wdGlvbnMuaW5jbHVkZSAmJiByZXN0T3B0aW9ucy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICAgIHBhcnNlUXVlcnkuX2luY2x1ZGUgPSByZXN0T3B0aW9ucy5pbmNsdWRlLnNwbGl0KCcsJyk7XG4gICAgfVxuICAgIGlmIChyZXN0T3B0aW9ucy5za2lwKSB7XG4gICAgICBwYXJzZVF1ZXJ5Ll9za2lwID0gcmVzdE9wdGlvbnMuc2tpcDtcbiAgICB9XG4gICAgaWYgKHJlc3RPcHRpb25zLmxpbWl0KSB7XG4gICAgICBwYXJzZVF1ZXJ5Ll9saW1pdCA9IHJlc3RPcHRpb25zLmxpbWl0O1xuICAgIH1cbiAgICBjb3VudCA9ICEhcmVzdE9wdGlvbnMuY291bnQ7XG4gIH1cbiAgY29uc3QgcmVxdWVzdE9iamVjdCA9IGdldFJlcXVlc3RRdWVyeU9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgcGFyc2VRdWVyeSwgY291bnQsIGNvbmZpZywgaXNHZXQpO1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRyaWdnZXIocmVxdWVzdE9iamVjdCk7XG4gIH0pLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgIGxldCBxdWVyeVJlc3VsdCA9IHBhcnNlUXVlcnk7XG4gICAgaWYgKHJlc3VsdCAmJiByZXN1bHQgaW5zdGFuY2VvZiBQYXJzZS5RdWVyeSkge1xuICAgICAgcXVlcnlSZXN1bHQgPSByZXN1bHQ7XG4gICAgfVxuICAgIGNvbnN0IGpzb25RdWVyeSA9IHF1ZXJ5UmVzdWx0LnRvSlNPTigpO1xuICAgIGlmIChqc29uUXVlcnkud2hlcmUpIHtcbiAgICAgIHJlc3RXaGVyZSA9IGpzb25RdWVyeS53aGVyZTtcbiAgICB9XG4gICAgaWYgKGpzb25RdWVyeS5saW1pdCkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLmxpbWl0ID0ganNvblF1ZXJ5LmxpbWl0O1xuICAgIH1cbiAgICBpZiAoanNvblF1ZXJ5LnNraXApIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5za2lwID0ganNvblF1ZXJ5LnNraXA7XG4gICAgfVxuICAgIGlmIChqc29uUXVlcnkuaW5jbHVkZSkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGUgPSBqc29uUXVlcnkuaW5jbHVkZTtcbiAgICB9XG4gICAgaWYgKGpzb25RdWVyeS5rZXlzKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMua2V5cyA9IGpzb25RdWVyeS5rZXlzO1xuICAgIH1cbiAgICBpZiAoanNvblF1ZXJ5Lm9yZGVyKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMub3JkZXIgPSBqc29uUXVlcnkub3JkZXI7XG4gICAgfVxuICAgIGlmIChyZXF1ZXN0T2JqZWN0LnJlYWRQcmVmZXJlbmNlKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMucmVhZFByZWZlcmVuY2UgPSByZXF1ZXN0T2JqZWN0LnJlYWRQcmVmZXJlbmNlO1xuICAgIH1cbiAgICBpZiAocmVxdWVzdE9iamVjdC5pbmNsdWRlUmVhZFByZWZlcmVuY2UpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5pbmNsdWRlUmVhZFByZWZlcmVuY2UgPSByZXF1ZXN0T2JqZWN0LmluY2x1ZGVSZWFkUHJlZmVyZW5jZTtcbiAgICB9XG4gICAgaWYgKHJlcXVlc3RPYmplY3Quc3VicXVlcnlSZWFkUHJlZmVyZW5jZSkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2UgPSByZXF1ZXN0T2JqZWN0LnN1YnF1ZXJ5UmVhZFByZWZlcmVuY2U7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICByZXN0V2hlcmUsXG4gICAgICByZXN0T3B0aW9uc1xuICAgIH07XG4gIH0sIChlcnIpID0+IHtcbiAgICBpZiAodHlwZW9mIGVyciA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxLCBlcnIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9KTtcbn1cblxuLy8gVG8gYmUgdXNlZCBhcyBwYXJ0IG9mIHRoZSBwcm9taXNlIGNoYWluIHdoZW4gc2F2aW5nL2RlbGV0aW5nIGFuIG9iamVjdFxuLy8gV2lsbCByZXNvbHZlIHN1Y2Nlc3NmdWxseSBpZiBubyB0cmlnZ2VyIGlzIGNvbmZpZ3VyZWRcbi8vIFJlc29sdmVzIHRvIGFuIG9iamVjdCwgZW1wdHkgb3IgY29udGFpbmluZyBhbiBvYmplY3Qga2V5LiBBIGJlZm9yZVNhdmVcbi8vIHRyaWdnZXIgd2lsbCBzZXQgdGhlIG9iamVjdCBrZXkgdG8gdGhlIHJlc3QgZm9ybWF0IG9iamVjdCB0byBzYXZlLlxuLy8gb3JpZ2luYWxQYXJzZU9iamVjdCBpcyBvcHRpb25hbCwgd2Ugb25seSBuZWVkIHRoYXQgZm9yIGJlZm9yZS9hZnRlclNhdmUgZnVuY3Rpb25zXG5leHBvcnQgZnVuY3Rpb24gbWF5YmVSdW5UcmlnZ2VyKHRyaWdnZXJUeXBlLCBhdXRoLCBwYXJzZU9iamVjdCwgb3JpZ2luYWxQYXJzZU9iamVjdCwgY29uZmlnKSB7XG4gIGlmICghcGFyc2VPYmplY3QpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHt9KTtcbiAgfVxuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHZhciB0cmlnZ2VyID0gZ2V0VHJpZ2dlcihwYXJzZU9iamVjdC5jbGFzc05hbWUsIHRyaWdnZXJUeXBlLCBjb25maWcuYXBwbGljYXRpb25JZCk7XG4gICAgaWYgKCF0cmlnZ2VyKSByZXR1cm4gcmVzb2x2ZSgpO1xuICAgIHZhciByZXF1ZXN0ID0gZ2V0UmVxdWVzdE9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgcGFyc2VPYmplY3QsIG9yaWdpbmFsUGFyc2VPYmplY3QsIGNvbmZpZyk7XG4gICAgdmFyIHJlc3BvbnNlID0gZ2V0UmVzcG9uc2VPYmplY3QocmVxdWVzdCwgKG9iamVjdCkgPT4ge1xuICAgICAgbG9nVHJpZ2dlclN1Y2Nlc3NCZWZvcmVIb29rKFxuICAgICAgICB0cmlnZ2VyVHlwZSwgcGFyc2VPYmplY3QuY2xhc3NOYW1lLCBwYXJzZU9iamVjdC50b0pTT04oKSwgb2JqZWN0LCBhdXRoKTtcbiAgICAgIHJlc29sdmUob2JqZWN0KTtcbiAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgIGxvZ1RyaWdnZXJFcnJvckJlZm9yZUhvb2soXG4gICAgICAgIHRyaWdnZXJUeXBlLCBwYXJzZU9iamVjdC5jbGFzc05hbWUsIHBhcnNlT2JqZWN0LnRvSlNPTigpLCBhdXRoLCBlcnJvcik7XG4gICAgICByZWplY3QoZXJyb3IpO1xuICAgIH0pO1xuICAgIC8vIEZvcmNlIHRoZSBjdXJyZW50IFBhcnNlIGFwcCBiZWZvcmUgdGhlIHRyaWdnZXJcbiAgICBQYXJzZS5hcHBsaWNhdGlvbklkID0gY29uZmlnLmFwcGxpY2F0aW9uSWQ7XG4gICAgUGFyc2UuamF2YXNjcmlwdEtleSA9IGNvbmZpZy5qYXZhc2NyaXB0S2V5IHx8ICcnO1xuICAgIFBhcnNlLm1hc3RlcktleSA9IGNvbmZpZy5tYXN0ZXJLZXk7XG5cbiAgICAvLyBBZnRlclNhdmUgYW5kIGFmdGVyRGVsZXRlIHRyaWdnZXJzIGNhbiByZXR1cm4gYSBwcm9taXNlLCB3aGljaCBpZiB0aGV5XG4gICAgLy8gZG8sIG5lZWRzIHRvIGJlIHJlc29sdmVkIGJlZm9yZSB0aGlzIHByb21pc2UgaXMgcmVzb2x2ZWQsXG4gICAgLy8gc28gdHJpZ2dlciBleGVjdXRpb24gaXMgc3luY2VkIHdpdGggUmVzdFdyaXRlLmV4ZWN1dGUoKSBjYWxsLlxuICAgIC8vIElmIHRyaWdnZXJzIGRvIG5vdCByZXR1cm4gYSBwcm9taXNlLCB0aGV5IGNhbiBydW4gYXN5bmMgY29kZSBwYXJhbGxlbFxuICAgIC8vIHRvIHRoZSBSZXN0V3JpdGUuZXhlY3V0ZSgpIGNhbGwuXG4gICAgdmFyIHRyaWdnZXJQcm9taXNlID0gdHJpZ2dlcihyZXF1ZXN0LCByZXNwb25zZSk7XG4gICAgaWYodHJpZ2dlclR5cGUgPT09IFR5cGVzLmFmdGVyU2F2ZSB8fCB0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJEZWxldGUpXG4gICAge1xuICAgICAgbG9nVHJpZ2dlckFmdGVySG9vayh0cmlnZ2VyVHlwZSwgcGFyc2VPYmplY3QuY2xhc3NOYW1lLCBwYXJzZU9iamVjdC50b0pTT04oKSwgYXV0aCk7XG4gICAgICBpZih0cmlnZ2VyUHJvbWlzZSAmJiB0eXBlb2YgdHJpZ2dlclByb21pc2UudGhlbiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiB0cmlnZ2VyUHJvbWlzZS50aGVuKHJlc29sdmUsIHJlc29sdmUpO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuLy8gQ29udmVydHMgYSBSRVNULWZvcm1hdCBvYmplY3QgdG8gYSBQYXJzZS5PYmplY3Rcbi8vIGRhdGEgaXMgZWl0aGVyIGNsYXNzTmFtZSBvciBhbiBvYmplY3RcbmV4cG9ydCBmdW5jdGlvbiBpbmZsYXRlKGRhdGEsIHJlc3RPYmplY3QpIHtcbiAgdmFyIGNvcHkgPSB0eXBlb2YgZGF0YSA9PSAnb2JqZWN0JyA/IGRhdGEgOiB7Y2xhc3NOYW1lOiBkYXRhfTtcbiAgZm9yICh2YXIga2V5IGluIHJlc3RPYmplY3QpIHtcbiAgICBjb3B5W2tleV0gPSByZXN0T2JqZWN0W2tleV07XG4gIH1cbiAgcmV0dXJuIFBhcnNlLk9iamVjdC5mcm9tSlNPTihjb3B5KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMoZGF0YSwgYXBwbGljYXRpb25JZCA9IFBhcnNlLmFwcGxpY2F0aW9uSWQpIHtcbiAgaWYgKCFfdHJpZ2dlclN0b3JlIHx8ICFfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8ICFfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkxpdmVRdWVyeSkgeyByZXR1cm47IH1cbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXS5MaXZlUXVlcnkuZm9yRWFjaCgoaGFuZGxlcikgPT4gaGFuZGxlcihkYXRhKSk7XG59XG4iXX0=