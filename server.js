// server.js - small complete server. No npm packages needed. Run: node server.js
// Put clips.html, clips-style.css, clips-ui.js and clips-cut-ui.js in a folder called "public".
// Put clips-cut.js (and your clips.js) next to this file.
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var cut = require('./clips-cut');

// If your clips.js exports a function (req, res), uncomment these two lines:
// var clips = require('./clips');

var PUBLIC = path.join(__dirname, 'public');
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

http.createServer(function (req, res) {
  var pathname = new URL(req.url, 'http://localhost').pathname;

  if (req.method === 'POST' && pathname === '/api/research/cut') {
    return cut(req, res);
  }

  // if (req.method === 'GET' && pathname === '/api/research/clips') {
  //   return clips(req, res);
  // }

  if (pathname === '/') pathname = '/clips.html';

  var file = path.normalize(path.join(PUBLIC, pathname));
  if (file.indexOf(PUBLIC) !== 0) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  fs.readFile(file, function (err, data) {
    if (err) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(process.env.PORT || 3000, function () {
  console.log('Running on http://localhost:' + (process.env.PORT || 3000));
});
