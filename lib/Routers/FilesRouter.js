'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FilesRouter = undefined;

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _bodyParser = require('body-parser');

var _bodyParser2 = _interopRequireDefault(_bodyParser);

var _middlewares = require('../middlewares');

var Middlewares = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _mime = require('mime');

var _mime2 = _interopRequireDefault(_mime);

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class FilesRouter {

  expressRouter({ maxUploadSize = '20Mb' } = {}) {
    var router = _express2.default.Router();
    router.get('/files/:appId/:filename', this.getHandler);

    router.post('/files', function (req, res, next) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename not provided.'));
    });

    router.post('/files/:filename', Middlewares.allowCrossDomain, _bodyParser2.default.raw({ type: () => {
        return true;
      }, limit: maxUploadSize }), // Allow uploads without Content-Type, or with any Content-Type.
    Middlewares.handleParseHeaders, this.createHandler);

    router.delete('/files/:filename', Middlewares.allowCrossDomain, Middlewares.handleParseHeaders, Middlewares.enforceMasterKeyAccess, this.deleteHandler);
    return router;
  }

  getHandler(req, res) {
    const config = _Config2.default.get(req.params.appId);
    const filesController = config.filesController;
    const filename = req.params.filename;
    const contentType = _mime2.default.getType(filename);
    if (isFileStreamable(req, filesController)) {
      filesController.getFileStream(config, filename).then(stream => {
        handleFileStream(stream, req, res, contentType);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    } else {
      filesController.getFileData(config, filename).then(data => {
        res.status(200);
        res.set('Content-Type', contentType);
        res.set('Content-Length', data.length);
        res.set('Cache-Control', 'public');
        res.end(data);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    }
  }

  createHandler(req, res, next) {
    if (!req.body || !req.body.length) {
      next(new _node2.default.Error(_node2.default.Error.FILE_SAVE_ERROR, 'Invalid file upload.'));
      return;
    }

    if (req.params.filename.length > 128) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename too long.'));
      return;
    }

    if (!req.params.filename.match(/^[_a-zA-Z0-9][a-zA-Z0-9@\.\ ~_-]*$/)) {
      next(new _node2.default.Error(_node2.default.Error.INVALID_FILE_NAME, 'Filename contains invalid characters.'));
      return;
    }

    const filename = req.params.filename;
    const contentType = req.get('Content-type');
    const config = req.config;
    const filesController = config.filesController;

    filesController.createFile(config, filename, req.body, contentType).then(result => {
      res.status(201);
      res.set('Location', result.url);
      res.json(result);
    }).catch(e => {
      _logger2.default.error(e.message, e);
      next(new _node2.default.Error(_node2.default.Error.FILE_SAVE_ERROR, 'Could not store file.'));
    });
  }

  deleteHandler(req, res, next) {
    const filesController = req.config.filesController;
    filesController.deleteFile(req.config, req.params.filename).then(() => {
      res.status(200);
      // TODO: return useful JSON here?
      res.end();
    }).catch(() => {
      next(new _node2.default.Error(_node2.default.Error.FILE_DELETE_ERROR, 'Could not delete file.'));
    });
  }
}

exports.FilesRouter = FilesRouter;
function isFileStreamable(req, filesController) {
  return req.get('Range') && typeof filesController.adapter.getFileStream === 'function';
}

function getRange(req) {
  const parts = req.get('Range').replace(/bytes=/, "").split("-");
  return { start: parseInt(parts[0], 10), end: parseInt(parts[1], 10) };
}

// handleFileStream is licenced under Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/).
// Author: LEROIB at weightingformypizza (https://weightingformypizza.wordpress.com/2015/06/24/stream-html5-media-content-like-video-audio-from-mongodb-using-express-and-gridstore/).
function handleFileStream(stream, req, res, contentType) {
  const buffer_size = 1024 * 1024; //1024Kb
  // Range request, partiall stream the file
  let {
    start, end
  } = getRange(req);

  const notEnded = !end && end !== 0;
  const notStarted = !start && start !== 0;
  // No end provided, we want all bytes
  if (notEnded) {
    end = stream.length - 1;
  }
  // No start provided, we're reading backwards
  if (notStarted) {
    start = stream.length - end;
    end = start + end - 1;
  }

  // Data exceeds the buffer_size, cap
  if (end - start >= buffer_size) {
    end = start + buffer_size - 1;
  }

  const contentLength = end - start + 1;

  res.writeHead(206, {
    'Content-Range': 'bytes ' + start + '-' + end + '/' + stream.length,
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength,
    'Content-Type': contentType
  });

  stream.seek(start, function () {
    // get gridFile stream
    const gridFileStream = stream.stream(true);
    let bufferAvail = 0;
    let remainingBytesToWrite = contentLength;
    let totalBytesWritten = 0;
    // write to response
    gridFileStream.on('data', function (data) {
      bufferAvail += data.length;
      if (bufferAvail > 0) {
        // slice returns the same buffer if overflowing
        // safe to call in any case
        const buffer = data.slice(0, remainingBytesToWrite);
        // write the buffer
        res.write(buffer);
        // increment total
        totalBytesWritten += buffer.length;
        // decrement remaining
        remainingBytesToWrite -= data.length;
        // decrement the avaialbe buffer
        bufferAvail -= buffer.length;
      }
      // in case of small slices, all values will be good at that point
      // we've written enough, end...
      if (totalBytesWritten >= contentLength) {
        stream.close();
        res.end();
        this.destroy();
      }
    });
  });
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZpbGVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIk1pZGRsZXdhcmVzIiwiRmlsZXNSb3V0ZXIiLCJleHByZXNzUm91dGVyIiwibWF4VXBsb2FkU2l6ZSIsInJvdXRlciIsImV4cHJlc3MiLCJSb3V0ZXIiLCJnZXQiLCJnZXRIYW5kbGVyIiwicG9zdCIsInJlcSIsInJlcyIsIm5leHQiLCJQYXJzZSIsIkVycm9yIiwiSU5WQUxJRF9GSUxFX05BTUUiLCJhbGxvd0Nyb3NzRG9tYWluIiwiQm9keVBhcnNlciIsInJhdyIsInR5cGUiLCJsaW1pdCIsImhhbmRsZVBhcnNlSGVhZGVycyIsImNyZWF0ZUhhbmRsZXIiLCJkZWxldGUiLCJlbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiZGVsZXRlSGFuZGxlciIsImNvbmZpZyIsIkNvbmZpZyIsInBhcmFtcyIsImFwcElkIiwiZmlsZXNDb250cm9sbGVyIiwiZmlsZW5hbWUiLCJjb250ZW50VHlwZSIsIm1pbWUiLCJnZXRUeXBlIiwiaXNGaWxlU3RyZWFtYWJsZSIsImdldEZpbGVTdHJlYW0iLCJ0aGVuIiwic3RyZWFtIiwiaGFuZGxlRmlsZVN0cmVhbSIsImNhdGNoIiwic3RhdHVzIiwic2V0IiwiZW5kIiwiZ2V0RmlsZURhdGEiLCJkYXRhIiwibGVuZ3RoIiwiYm9keSIsIkZJTEVfU0FWRV9FUlJPUiIsIm1hdGNoIiwiY3JlYXRlRmlsZSIsInJlc3VsdCIsInVybCIsImpzb24iLCJlIiwibG9nZ2VyIiwiZXJyb3IiLCJtZXNzYWdlIiwiZGVsZXRlRmlsZSIsIkZJTEVfREVMRVRFX0VSUk9SIiwiYWRhcHRlciIsImdldFJhbmdlIiwicGFydHMiLCJyZXBsYWNlIiwic3BsaXQiLCJzdGFydCIsInBhcnNlSW50IiwiYnVmZmVyX3NpemUiLCJub3RFbmRlZCIsIm5vdFN0YXJ0ZWQiLCJjb250ZW50TGVuZ3RoIiwid3JpdGVIZWFkIiwic2VlayIsImdyaWRGaWxlU3RyZWFtIiwiYnVmZmVyQXZhaWwiLCJyZW1haW5pbmdCeXRlc1RvV3JpdGUiLCJ0b3RhbEJ5dGVzV3JpdHRlbiIsIm9uIiwiYnVmZmVyIiwic2xpY2UiLCJ3cml0ZSIsImNsb3NlIiwiZGVzdHJveSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7SUFBWUEsVzs7QUFDWjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7Ozs7QUFFTyxNQUFNQyxXQUFOLENBQWtCOztBQUV2QkMsZ0JBQWMsRUFBRUMsZ0JBQWdCLE1BQWxCLEtBQTZCLEVBQTNDLEVBQStDO0FBQzdDLFFBQUlDLFNBQVNDLGtCQUFRQyxNQUFSLEVBQWI7QUFDQUYsV0FBT0csR0FBUCxDQUFXLHlCQUFYLEVBQXNDLEtBQUtDLFVBQTNDOztBQUVBSixXQUFPSyxJQUFQLENBQVksUUFBWixFQUFzQixVQUFTQyxHQUFULEVBQWNDLEdBQWQsRUFBbUJDLElBQW5CLEVBQXlCO0FBQzdDQSxXQUFLLElBQUlDLGVBQU1DLEtBQVYsQ0FBZ0JELGVBQU1DLEtBQU4sQ0FBWUMsaUJBQTVCLEVBQ0gsd0JBREcsQ0FBTDtBQUVELEtBSEQ7O0FBS0FYLFdBQU9LLElBQVAsQ0FBWSxrQkFBWixFQUNFVCxZQUFZZ0IsZ0JBRGQsRUFFRUMscUJBQVdDLEdBQVgsQ0FBZSxFQUFDQyxNQUFNLE1BQU07QUFBRSxlQUFPLElBQVA7QUFBYyxPQUE3QixFQUErQkMsT0FBT2pCLGFBQXRDLEVBQWYsQ0FGRixFQUV5RTtBQUN2RUgsZ0JBQVlxQixrQkFIZCxFQUlFLEtBQUtDLGFBSlA7O0FBT0FsQixXQUFPbUIsTUFBUCxDQUFjLGtCQUFkLEVBQ0V2QixZQUFZZ0IsZ0JBRGQsRUFFRWhCLFlBQVlxQixrQkFGZCxFQUdFckIsWUFBWXdCLHNCQUhkLEVBSUUsS0FBS0MsYUFKUDtBQU1BLFdBQU9yQixNQUFQO0FBQ0Q7O0FBRURJLGFBQVdFLEdBQVgsRUFBZ0JDLEdBQWhCLEVBQXFCO0FBQ25CLFVBQU1lLFNBQVNDLGlCQUFPcEIsR0FBUCxDQUFXRyxJQUFJa0IsTUFBSixDQUFXQyxLQUF0QixDQUFmO0FBQ0EsVUFBTUMsa0JBQWtCSixPQUFPSSxlQUEvQjtBQUNBLFVBQU1DLFdBQVdyQixJQUFJa0IsTUFBSixDQUFXRyxRQUE1QjtBQUNBLFVBQU1DLGNBQWNDLGVBQUtDLE9BQUwsQ0FBYUgsUUFBYixDQUFwQjtBQUNBLFFBQUlJLGlCQUFpQnpCLEdBQWpCLEVBQXNCb0IsZUFBdEIsQ0FBSixFQUE0QztBQUMxQ0Esc0JBQWdCTSxhQUFoQixDQUE4QlYsTUFBOUIsRUFBc0NLLFFBQXRDLEVBQWdETSxJQUFoRCxDQUFzREMsTUFBRCxJQUFZO0FBQy9EQyx5QkFBaUJELE1BQWpCLEVBQXlCNUIsR0FBekIsRUFBOEJDLEdBQTlCLEVBQW1DcUIsV0FBbkM7QUFDRCxPQUZELEVBRUdRLEtBRkgsQ0FFUyxNQUFNO0FBQ2I3QixZQUFJOEIsTUFBSixDQUFXLEdBQVg7QUFDQTlCLFlBQUkrQixHQUFKLENBQVEsY0FBUixFQUF3QixZQUF4QjtBQUNBL0IsWUFBSWdDLEdBQUosQ0FBUSxpQkFBUjtBQUNELE9BTkQ7QUFPRCxLQVJELE1BUU87QUFDTGIsc0JBQWdCYyxXQUFoQixDQUE0QmxCLE1BQTVCLEVBQW9DSyxRQUFwQyxFQUE4Q00sSUFBOUMsQ0FBb0RRLElBQUQsSUFBVTtBQUMzRGxDLFlBQUk4QixNQUFKLENBQVcsR0FBWDtBQUNBOUIsWUFBSStCLEdBQUosQ0FBUSxjQUFSLEVBQXdCVixXQUF4QjtBQUNBckIsWUFBSStCLEdBQUosQ0FBUSxnQkFBUixFQUEwQkcsS0FBS0MsTUFBL0I7QUFDQW5DLFlBQUkrQixHQUFKLENBQVEsZUFBUixFQUF5QixRQUF6QjtBQUNBL0IsWUFBSWdDLEdBQUosQ0FBUUUsSUFBUjtBQUNELE9BTkQsRUFNR0wsS0FOSCxDQU1TLE1BQU07QUFDYjdCLFlBQUk4QixNQUFKLENBQVcsR0FBWDtBQUNBOUIsWUFBSStCLEdBQUosQ0FBUSxjQUFSLEVBQXdCLFlBQXhCO0FBQ0EvQixZQUFJZ0MsR0FBSixDQUFRLGlCQUFSO0FBQ0QsT0FWRDtBQVdEO0FBQ0Y7O0FBRURyQixnQkFBY1osR0FBZCxFQUFtQkMsR0FBbkIsRUFBd0JDLElBQXhCLEVBQThCO0FBQzVCLFFBQUksQ0FBQ0YsSUFBSXFDLElBQUwsSUFBYSxDQUFDckMsSUFBSXFDLElBQUosQ0FBU0QsTUFBM0IsRUFBbUM7QUFDakNsQyxXQUFLLElBQUlDLGVBQU1DLEtBQVYsQ0FBZ0JELGVBQU1DLEtBQU4sQ0FBWWtDLGVBQTVCLEVBQ0gsc0JBREcsQ0FBTDtBQUVBO0FBQ0Q7O0FBRUQsUUFBSXRDLElBQUlrQixNQUFKLENBQVdHLFFBQVgsQ0FBb0JlLE1BQXBCLEdBQTZCLEdBQWpDLEVBQXNDO0FBQ3BDbEMsV0FBSyxJQUFJQyxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVlDLGlCQUE1QixFQUNILG9CQURHLENBQUw7QUFFQTtBQUNEOztBQUVELFFBQUksQ0FBQ0wsSUFBSWtCLE1BQUosQ0FBV0csUUFBWCxDQUFvQmtCLEtBQXBCLENBQTBCLG9DQUExQixDQUFMLEVBQXNFO0FBQ3BFckMsV0FBSyxJQUFJQyxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVlDLGlCQUE1QixFQUNILHVDQURHLENBQUw7QUFFQTtBQUNEOztBQUVELFVBQU1nQixXQUFXckIsSUFBSWtCLE1BQUosQ0FBV0csUUFBNUI7QUFDQSxVQUFNQyxjQUFjdEIsSUFBSUgsR0FBSixDQUFRLGNBQVIsQ0FBcEI7QUFDQSxVQUFNbUIsU0FBU2hCLElBQUlnQixNQUFuQjtBQUNBLFVBQU1JLGtCQUFrQkosT0FBT0ksZUFBL0I7O0FBRUFBLG9CQUFnQm9CLFVBQWhCLENBQTJCeEIsTUFBM0IsRUFBbUNLLFFBQW5DLEVBQTZDckIsSUFBSXFDLElBQWpELEVBQXVEZixXQUF2RCxFQUFvRUssSUFBcEUsQ0FBMEVjLE1BQUQsSUFBWTtBQUNuRnhDLFVBQUk4QixNQUFKLENBQVcsR0FBWDtBQUNBOUIsVUFBSStCLEdBQUosQ0FBUSxVQUFSLEVBQW9CUyxPQUFPQyxHQUEzQjtBQUNBekMsVUFBSTBDLElBQUosQ0FBU0YsTUFBVDtBQUNELEtBSkQsRUFJR1gsS0FKSCxDQUlVYyxDQUFELElBQU87QUFDZEMsdUJBQU9DLEtBQVAsQ0FBYUYsRUFBRUcsT0FBZixFQUF3QkgsQ0FBeEI7QUFDQTFDLFdBQUssSUFBSUMsZUFBTUMsS0FBVixDQUFnQkQsZUFBTUMsS0FBTixDQUFZa0MsZUFBNUIsRUFBNkMsdUJBQTdDLENBQUw7QUFDRCxLQVBEO0FBUUQ7O0FBRUR2QixnQkFBY2YsR0FBZCxFQUFtQkMsR0FBbkIsRUFBd0JDLElBQXhCLEVBQThCO0FBQzVCLFVBQU1rQixrQkFBa0JwQixJQUFJZ0IsTUFBSixDQUFXSSxlQUFuQztBQUNBQSxvQkFBZ0I0QixVQUFoQixDQUEyQmhELElBQUlnQixNQUEvQixFQUF1Q2hCLElBQUlrQixNQUFKLENBQVdHLFFBQWxELEVBQTRETSxJQUE1RCxDQUFpRSxNQUFNO0FBQ3JFMUIsVUFBSThCLE1BQUosQ0FBVyxHQUFYO0FBQ0E7QUFDQTlCLFVBQUlnQyxHQUFKO0FBQ0QsS0FKRCxFQUlHSCxLQUpILENBSVMsTUFBTTtBQUNiNUIsV0FBSyxJQUFJQyxlQUFNQyxLQUFWLENBQWdCRCxlQUFNQyxLQUFOLENBQVk2QyxpQkFBNUIsRUFDSCx3QkFERyxDQUFMO0FBRUQsS0FQRDtBQVFEO0FBbkdzQjs7UUFBWjFELFcsR0FBQUEsVztBQXNHYixTQUFTa0MsZ0JBQVQsQ0FBMEJ6QixHQUExQixFQUErQm9CLGVBQS9CLEVBQStDO0FBQzdDLFNBQVFwQixJQUFJSCxHQUFKLENBQVEsT0FBUixLQUFvQixPQUFPdUIsZ0JBQWdCOEIsT0FBaEIsQ0FBd0J4QixhQUEvQixLQUFpRCxVQUE3RTtBQUNEOztBQUVELFNBQVN5QixRQUFULENBQWtCbkQsR0FBbEIsRUFBdUI7QUFDckIsUUFBTW9ELFFBQVFwRCxJQUFJSCxHQUFKLENBQVEsT0FBUixFQUFpQndELE9BQWpCLENBQXlCLFFBQXpCLEVBQW1DLEVBQW5DLEVBQXVDQyxLQUF2QyxDQUE2QyxHQUE3QyxDQUFkO0FBQ0EsU0FBTyxFQUFFQyxPQUFPQyxTQUFTSixNQUFNLENBQU4sQ0FBVCxFQUFtQixFQUFuQixDQUFULEVBQWlDbkIsS0FBS3VCLFNBQVNKLE1BQU0sQ0FBTixDQUFULEVBQW1CLEVBQW5CLENBQXRDLEVBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0EsU0FBU3ZCLGdCQUFULENBQTBCRCxNQUExQixFQUFrQzVCLEdBQWxDLEVBQXVDQyxHQUF2QyxFQUE0Q3FCLFdBQTVDLEVBQXlEO0FBQ3ZELFFBQU1tQyxjQUFjLE9BQU8sSUFBM0IsQ0FEdUQsQ0FDdEI7QUFDakM7QUFDQSxNQUFJO0FBQ0ZGLFNBREUsRUFDS3RCO0FBREwsTUFFQWtCLFNBQVNuRCxHQUFULENBRko7O0FBSUEsUUFBTTBELFdBQVksQ0FBQ3pCLEdBQUQsSUFBUUEsUUFBUSxDQUFsQztBQUNBLFFBQU0wQixhQUFjLENBQUNKLEtBQUQsSUFBVUEsVUFBVSxDQUF4QztBQUNBO0FBQ0EsTUFBSUcsUUFBSixFQUFjO0FBQ1p6QixVQUFNTCxPQUFPUSxNQUFQLEdBQWdCLENBQXRCO0FBQ0Q7QUFDRDtBQUNBLE1BQUl1QixVQUFKLEVBQWdCO0FBQ2RKLFlBQVEzQixPQUFPUSxNQUFQLEdBQWdCSCxHQUF4QjtBQUNBQSxVQUFNc0IsUUFBUXRCLEdBQVIsR0FBYyxDQUFwQjtBQUNEOztBQUVEO0FBQ0EsTUFBSUEsTUFBTXNCLEtBQU4sSUFBZUUsV0FBbkIsRUFBZ0M7QUFDOUJ4QixVQUFNc0IsUUFBUUUsV0FBUixHQUFzQixDQUE1QjtBQUNEOztBQUVELFFBQU1HLGdCQUFpQjNCLE1BQU1zQixLQUFQLEdBQWdCLENBQXRDOztBQUVBdEQsTUFBSTRELFNBQUosQ0FBYyxHQUFkLEVBQW1CO0FBQ2pCLHFCQUFpQixXQUFXTixLQUFYLEdBQW1CLEdBQW5CLEdBQXlCdEIsR0FBekIsR0FBK0IsR0FBL0IsR0FBcUNMLE9BQU9RLE1BRDVDO0FBRWpCLHFCQUFpQixPQUZBO0FBR2pCLHNCQUFrQndCLGFBSEQ7QUFJakIsb0JBQWdCdEM7QUFKQyxHQUFuQjs7QUFPQU0sU0FBT2tDLElBQVAsQ0FBWVAsS0FBWixFQUFtQixZQUFZO0FBQzdCO0FBQ0EsVUFBTVEsaUJBQWlCbkMsT0FBT0EsTUFBUCxDQUFjLElBQWQsQ0FBdkI7QUFDQSxRQUFJb0MsY0FBYyxDQUFsQjtBQUNBLFFBQUlDLHdCQUF3QkwsYUFBNUI7QUFDQSxRQUFJTSxvQkFBb0IsQ0FBeEI7QUFDQTtBQUNBSCxtQkFBZUksRUFBZixDQUFrQixNQUFsQixFQUEwQixVQUFVaEMsSUFBVixFQUFnQjtBQUN4QzZCLHFCQUFlN0IsS0FBS0MsTUFBcEI7QUFDQSxVQUFJNEIsY0FBYyxDQUFsQixFQUFxQjtBQUNuQjtBQUNBO0FBQ0EsY0FBTUksU0FBU2pDLEtBQUtrQyxLQUFMLENBQVcsQ0FBWCxFQUFjSixxQkFBZCxDQUFmO0FBQ0E7QUFDQWhFLFlBQUlxRSxLQUFKLENBQVVGLE1BQVY7QUFDQTtBQUNBRiw2QkFBcUJFLE9BQU9oQyxNQUE1QjtBQUNBO0FBQ0E2QixpQ0FBeUI5QixLQUFLQyxNQUE5QjtBQUNBO0FBQ0E0Qix1QkFBZUksT0FBT2hDLE1BQXRCO0FBQ0Q7QUFDRDtBQUNBO0FBQ0EsVUFBSThCLHFCQUFxQk4sYUFBekIsRUFBd0M7QUFDdENoQyxlQUFPMkMsS0FBUDtBQUNBdEUsWUFBSWdDLEdBQUo7QUFDQSxhQUFLdUMsT0FBTDtBQUNEO0FBQ0YsS0F0QkQ7QUF1QkQsR0E5QkQ7QUErQkQiLCJmaWxlIjoiRmlsZXNSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgZXhwcmVzcyAgICAgICAgICAgICBmcm9tICdleHByZXNzJztcbmltcG9ydCBCb2R5UGFyc2VyICAgICAgICAgIGZyb20gJ2JvZHktcGFyc2VyJztcbmltcG9ydCAqIGFzIE1pZGRsZXdhcmVzICAgIGZyb20gJy4uL21pZGRsZXdhcmVzJztcbmltcG9ydCBQYXJzZSAgICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IENvbmZpZyAgICAgICAgICAgICAgZnJvbSAnLi4vQ29uZmlnJztcbmltcG9ydCBtaW1lICAgICAgICAgICAgICAgIGZyb20gJ21pbWUnO1xuaW1wb3J0IGxvZ2dlciAgICAgICAgICAgICAgZnJvbSAnLi4vbG9nZ2VyJztcblxuZXhwb3J0IGNsYXNzIEZpbGVzUm91dGVyIHtcblxuICBleHByZXNzUm91dGVyKHsgbWF4VXBsb2FkU2l6ZSA9ICcyME1iJyB9ID0ge30pIHtcbiAgICB2YXIgcm91dGVyID0gZXhwcmVzcy5Sb3V0ZXIoKTtcbiAgICByb3V0ZXIuZ2V0KCcvZmlsZXMvOmFwcElkLzpmaWxlbmFtZScsIHRoaXMuZ2V0SGFuZGxlcik7XG5cbiAgICByb3V0ZXIucG9zdCgnL2ZpbGVzJywgZnVuY3Rpb24ocmVxLCByZXMsIG5leHQpIHtcbiAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRklMRV9OQU1FLFxuICAgICAgICAnRmlsZW5hbWUgbm90IHByb3ZpZGVkLicpKTtcbiAgICB9KTtcblxuICAgIHJvdXRlci5wb3N0KCcvZmlsZXMvOmZpbGVuYW1lJyxcbiAgICAgIE1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4sXG4gICAgICBCb2R5UGFyc2VyLnJhdyh7dHlwZTogKCkgPT4geyByZXR1cm4gdHJ1ZTsgfSwgbGltaXQ6IG1heFVwbG9hZFNpemUgfSksIC8vIEFsbG93IHVwbG9hZHMgd2l0aG91dCBDb250ZW50LVR5cGUsIG9yIHdpdGggYW55IENvbnRlbnQtVHlwZS5cbiAgICAgIE1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlSGVhZGVycyxcbiAgICAgIHRoaXMuY3JlYXRlSGFuZGxlclxuICAgICk7XG5cbiAgICByb3V0ZXIuZGVsZXRlKCcvZmlsZXMvOmZpbGVuYW1lJyxcbiAgICAgIE1pZGRsZXdhcmVzLmFsbG93Q3Jvc3NEb21haW4sXG4gICAgICBNaWRkbGV3YXJlcy5oYW5kbGVQYXJzZUhlYWRlcnMsXG4gICAgICBNaWRkbGV3YXJlcy5lbmZvcmNlTWFzdGVyS2V5QWNjZXNzLFxuICAgICAgdGhpcy5kZWxldGVIYW5kbGVyXG4gICAgKTtcbiAgICByZXR1cm4gcm91dGVyO1xuICB9XG5cbiAgZ2V0SGFuZGxlcihyZXEsIHJlcykge1xuICAgIGNvbnN0IGNvbmZpZyA9IENvbmZpZy5nZXQocmVxLnBhcmFtcy5hcHBJZCk7XG4gICAgY29uc3QgZmlsZXNDb250cm9sbGVyID0gY29uZmlnLmZpbGVzQ29udHJvbGxlcjtcbiAgICBjb25zdCBmaWxlbmFtZSA9IHJlcS5wYXJhbXMuZmlsZW5hbWU7XG4gICAgY29uc3QgY29udGVudFR5cGUgPSBtaW1lLmdldFR5cGUoZmlsZW5hbWUpO1xuICAgIGlmIChpc0ZpbGVTdHJlYW1hYmxlKHJlcSwgZmlsZXNDb250cm9sbGVyKSkge1xuICAgICAgZmlsZXNDb250cm9sbGVyLmdldEZpbGVTdHJlYW0oY29uZmlnLCBmaWxlbmFtZSkudGhlbigoc3RyZWFtKSA9PiB7XG4gICAgICAgIGhhbmRsZUZpbGVTdHJlYW0oc3RyZWFtLCByZXEsIHJlcywgY29udGVudFR5cGUpO1xuICAgICAgfSkuY2F0Y2goKCkgPT4ge1xuICAgICAgICByZXMuc3RhdHVzKDQwNCk7XG4gICAgICAgIHJlcy5zZXQoJ0NvbnRlbnQtVHlwZScsICd0ZXh0L3BsYWluJyk7XG4gICAgICAgIHJlcy5lbmQoJ0ZpbGUgbm90IGZvdW5kLicpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZpbGVzQ29udHJvbGxlci5nZXRGaWxlRGF0YShjb25maWcsIGZpbGVuYW1lKS50aGVuKChkYXRhKSA9PiB7XG4gICAgICAgIHJlcy5zdGF0dXMoMjAwKTtcbiAgICAgICAgcmVzLnNldCgnQ29udGVudC1UeXBlJywgY29udGVudFR5cGUpO1xuICAgICAgICByZXMuc2V0KCdDb250ZW50LUxlbmd0aCcsIGRhdGEubGVuZ3RoKTtcbiAgICAgICAgcmVzLnNldCgnQ2FjaGUtQ29udHJvbCcsICdwdWJsaWMnKTtcbiAgICAgICAgcmVzLmVuZChkYXRhKTtcbiAgICAgIH0pLmNhdGNoKCgpID0+IHtcbiAgICAgICAgcmVzLnN0YXR1cyg0MDQpO1xuICAgICAgICByZXMuc2V0KCdDb250ZW50LVR5cGUnLCAndGV4dC9wbGFpbicpO1xuICAgICAgICByZXMuZW5kKCdGaWxlIG5vdCBmb3VuZC4nKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGNyZWF0ZUhhbmRsZXIocmVxLCByZXMsIG5leHQpIHtcbiAgICBpZiAoIXJlcS5ib2R5IHx8ICFyZXEuYm9keS5sZW5ndGgpIHtcbiAgICAgIG5leHQobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkZJTEVfU0FWRV9FUlJPUixcbiAgICAgICAgJ0ludmFsaWQgZmlsZSB1cGxvYWQuJykpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChyZXEucGFyYW1zLmZpbGVuYW1lLmxlbmd0aCA+IDEyOCkge1xuICAgICAgbmV4dChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9GSUxFX05BTUUsXG4gICAgICAgICdGaWxlbmFtZSB0b28gbG9uZy4nKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFyZXEucGFyYW1zLmZpbGVuYW1lLm1hdGNoKC9eW19hLXpBLVowLTldW2EtekEtWjAtOUBcXC5cXCB+Xy1dKiQvKSkge1xuICAgICAgbmV4dChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9GSUxFX05BTUUsXG4gICAgICAgICdGaWxlbmFtZSBjb250YWlucyBpbnZhbGlkIGNoYXJhY3RlcnMuJykpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVuYW1lID0gcmVxLnBhcmFtcy5maWxlbmFtZTtcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlcS5nZXQoJ0NvbnRlbnQtdHlwZScpO1xuICAgIGNvbnN0IGNvbmZpZyA9IHJlcS5jb25maWc7XG4gICAgY29uc3QgZmlsZXNDb250cm9sbGVyID0gY29uZmlnLmZpbGVzQ29udHJvbGxlcjtcblxuICAgIGZpbGVzQ29udHJvbGxlci5jcmVhdGVGaWxlKGNvbmZpZywgZmlsZW5hbWUsIHJlcS5ib2R5LCBjb250ZW50VHlwZSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICByZXMuc3RhdHVzKDIwMSk7XG4gICAgICByZXMuc2V0KCdMb2NhdGlvbicsIHJlc3VsdC51cmwpO1xuICAgICAgcmVzLmpzb24ocmVzdWx0KTtcbiAgICB9KS5jYXRjaCgoZSkgPT4ge1xuICAgICAgbG9nZ2VyLmVycm9yKGUubWVzc2FnZSwgZSk7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX1NBVkVfRVJST1IsICdDb3VsZCBub3Qgc3RvcmUgZmlsZS4nKSk7XG4gICAgfSk7XG4gIH1cblxuICBkZWxldGVIYW5kbGVyKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgY29uc3QgZmlsZXNDb250cm9sbGVyID0gcmVxLmNvbmZpZy5maWxlc0NvbnRyb2xsZXI7XG4gICAgZmlsZXNDb250cm9sbGVyLmRlbGV0ZUZpbGUocmVxLmNvbmZpZywgcmVxLnBhcmFtcy5maWxlbmFtZSkudGhlbigoKSA9PiB7XG4gICAgICByZXMuc3RhdHVzKDIwMCk7XG4gICAgICAvLyBUT0RPOiByZXR1cm4gdXNlZnVsIEpTT04gaGVyZT9cbiAgICAgIHJlcy5lbmQoKTtcbiAgICB9KS5jYXRjaCgoKSA9PiB7XG4gICAgICBuZXh0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5GSUxFX0RFTEVURV9FUlJPUixcbiAgICAgICAgJ0NvdWxkIG5vdCBkZWxldGUgZmlsZS4nKSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNGaWxlU3RyZWFtYWJsZShyZXEsIGZpbGVzQ29udHJvbGxlcil7XG4gIHJldHVybiAgcmVxLmdldCgnUmFuZ2UnKSAmJiB0eXBlb2YgZmlsZXNDb250cm9sbGVyLmFkYXB0ZXIuZ2V0RmlsZVN0cmVhbSA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gZ2V0UmFuZ2UocmVxKSB7XG4gIGNvbnN0IHBhcnRzID0gcmVxLmdldCgnUmFuZ2UnKS5yZXBsYWNlKC9ieXRlcz0vLCBcIlwiKS5zcGxpdChcIi1cIik7XG4gIHJldHVybiB7IHN0YXJ0OiBwYXJzZUludChwYXJ0c1swXSwgMTApLCBlbmQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCkgfTtcbn1cblxuLy8gaGFuZGxlRmlsZVN0cmVhbSBpcyBsaWNlbmNlZCB1bmRlciBDcmVhdGl2ZSBDb21tb25zIEF0dHJpYnV0aW9uIDQuMCBJbnRlcm5hdGlvbmFsIExpY2Vuc2UgKGh0dHBzOi8vY3JlYXRpdmVjb21tb25zLm9yZy9saWNlbnNlcy9ieS80LjAvKS5cbi8vIEF1dGhvcjogTEVST0lCIGF0IHdlaWdodGluZ2Zvcm15cGl6emEgKGh0dHBzOi8vd2VpZ2h0aW5nZm9ybXlwaXp6YS53b3JkcHJlc3MuY29tLzIwMTUvMDYvMjQvc3RyZWFtLWh0bWw1LW1lZGlhLWNvbnRlbnQtbGlrZS12aWRlby1hdWRpby1mcm9tLW1vbmdvZGItdXNpbmctZXhwcmVzcy1hbmQtZ3JpZHN0b3JlLykuXG5mdW5jdGlvbiBoYW5kbGVGaWxlU3RyZWFtKHN0cmVhbSwgcmVxLCByZXMsIGNvbnRlbnRUeXBlKSB7XG4gIGNvbnN0IGJ1ZmZlcl9zaXplID0gMTAyNCAqIDEwMjQ7IC8vMTAyNEtiXG4gIC8vIFJhbmdlIHJlcXVlc3QsIHBhcnRpYWxsIHN0cmVhbSB0aGUgZmlsZVxuICBsZXQge1xuICAgIHN0YXJ0LCBlbmRcbiAgfSA9IGdldFJhbmdlKHJlcSk7XG5cbiAgY29uc3Qgbm90RW5kZWQgPSAoIWVuZCAmJiBlbmQgIT09IDApO1xuICBjb25zdCBub3RTdGFydGVkID0gKCFzdGFydCAmJiBzdGFydCAhPT0gMCk7XG4gIC8vIE5vIGVuZCBwcm92aWRlZCwgd2Ugd2FudCBhbGwgYnl0ZXNcbiAgaWYgKG5vdEVuZGVkKSB7XG4gICAgZW5kID0gc3RyZWFtLmxlbmd0aCAtIDE7XG4gIH1cbiAgLy8gTm8gc3RhcnQgcHJvdmlkZWQsIHdlJ3JlIHJlYWRpbmcgYmFja3dhcmRzXG4gIGlmIChub3RTdGFydGVkKSB7XG4gICAgc3RhcnQgPSBzdHJlYW0ubGVuZ3RoIC0gZW5kO1xuICAgIGVuZCA9IHN0YXJ0ICsgZW5kIC0gMTtcbiAgfVxuXG4gIC8vIERhdGEgZXhjZWVkcyB0aGUgYnVmZmVyX3NpemUsIGNhcFxuICBpZiAoZW5kIC0gc3RhcnQgPj0gYnVmZmVyX3NpemUpIHtcbiAgICBlbmQgPSBzdGFydCArIGJ1ZmZlcl9zaXplIC0gMTtcbiAgfVxuXG4gIGNvbnN0IGNvbnRlbnRMZW5ndGggPSAoZW5kIC0gc3RhcnQpICsgMTtcblxuICByZXMud3JpdGVIZWFkKDIwNiwge1xuICAgICdDb250ZW50LVJhbmdlJzogJ2J5dGVzICcgKyBzdGFydCArICctJyArIGVuZCArICcvJyArIHN0cmVhbS5sZW5ndGgsXG4gICAgJ0FjY2VwdC1SYW5nZXMnOiAnYnl0ZXMnLFxuICAgICdDb250ZW50LUxlbmd0aCc6IGNvbnRlbnRMZW5ndGgsXG4gICAgJ0NvbnRlbnQtVHlwZSc6IGNvbnRlbnRUeXBlLFxuICB9KTtcblxuICBzdHJlYW0uc2VlayhzdGFydCwgZnVuY3Rpb24gKCkge1xuICAgIC8vIGdldCBncmlkRmlsZSBzdHJlYW1cbiAgICBjb25zdCBncmlkRmlsZVN0cmVhbSA9IHN0cmVhbS5zdHJlYW0odHJ1ZSk7XG4gICAgbGV0IGJ1ZmZlckF2YWlsID0gMDtcbiAgICBsZXQgcmVtYWluaW5nQnl0ZXNUb1dyaXRlID0gY29udGVudExlbmd0aDtcbiAgICBsZXQgdG90YWxCeXRlc1dyaXR0ZW4gPSAwO1xuICAgIC8vIHdyaXRlIHRvIHJlc3BvbnNlXG4gICAgZ3JpZEZpbGVTdHJlYW0ub24oJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgYnVmZmVyQXZhaWwgKz0gZGF0YS5sZW5ndGg7XG4gICAgICBpZiAoYnVmZmVyQXZhaWwgPiAwKSB7XG4gICAgICAgIC8vIHNsaWNlIHJldHVybnMgdGhlIHNhbWUgYnVmZmVyIGlmIG92ZXJmbG93aW5nXG4gICAgICAgIC8vIHNhZmUgdG8gY2FsbCBpbiBhbnkgY2FzZVxuICAgICAgICBjb25zdCBidWZmZXIgPSBkYXRhLnNsaWNlKDAsIHJlbWFpbmluZ0J5dGVzVG9Xcml0ZSk7XG4gICAgICAgIC8vIHdyaXRlIHRoZSBidWZmZXJcbiAgICAgICAgcmVzLndyaXRlKGJ1ZmZlcik7XG4gICAgICAgIC8vIGluY3JlbWVudCB0b3RhbFxuICAgICAgICB0b3RhbEJ5dGVzV3JpdHRlbiArPSBidWZmZXIubGVuZ3RoO1xuICAgICAgICAvLyBkZWNyZW1lbnQgcmVtYWluaW5nXG4gICAgICAgIHJlbWFpbmluZ0J5dGVzVG9Xcml0ZSAtPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgLy8gZGVjcmVtZW50IHRoZSBhdmFpYWxiZSBidWZmZXJcbiAgICAgICAgYnVmZmVyQXZhaWwgLT0gYnVmZmVyLmxlbmd0aDtcbiAgICAgIH1cbiAgICAgIC8vIGluIGNhc2Ugb2Ygc21hbGwgc2xpY2VzLCBhbGwgdmFsdWVzIHdpbGwgYmUgZ29vZCBhdCB0aGF0IHBvaW50XG4gICAgICAvLyB3ZSd2ZSB3cml0dGVuIGVub3VnaCwgZW5kLi4uXG4gICAgICBpZiAodG90YWxCeXRlc1dyaXR0ZW4gPj0gY29udGVudExlbmd0aCkge1xuICAgICAgICBzdHJlYW0uY2xvc2UoKTtcbiAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICB0aGlzLmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59XG4iXX0=