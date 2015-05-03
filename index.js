'use strict';
var es = require('event-stream');
var source = require('vinyl-source-stream2');
var StreamCombiner = require('stream-combiner');
var browserify = require('browserify');
var path = require('path');
var xtend = require('xtend');
var through = require('through2');
var factor = require('uz-factor-bundle');

module.exports = function (opts) {
    if (!opts) {
        opts = {};
    }
    var cwd = process.cwd();
    opts.base = opts.basedir || cwd;
    var b = opts.b || browserify();
    var cache = opts.cache || {};
    opts.fullPaths = true;
    opts.exposeAll = true;
    b.on('dep', function (dep) {
        if (typeof dep.id === 'string') {
            cache[dep.id] = dep;
        }
    });
    //b.reset(opts);

    var vfiles = [];
    var outStream = es.through();
    outStream.pause();
    var inStream = through.obj(function write(vfile, enc, next) {
        vfiles.push(vfile);
        next(null);
    }, function end(done) {
        var ss = vfiles.map(function (vfile) {
            var s = source({
                cwd: vfile.cwd,
                base: vfile.base,
                path: vfile.path
            });
            s.on('error', function (err) {
                console.error(err);
                console.error(err.stack);
                return done();
            });
            return s;
        });
        var rfiles = vfiles.map(function (vfile) {
            return vfile.path;
        });
        var s = source({
            base: opts.base,
            path: opts.commonJsPath[0] === '/' ? opts.commonJsPath : path
                .join(opts.base, opts.commonJsPath),
            cwd: cwd
        });
        var ess = es.merge.apply(null, ss.concat(s));
        ess.pipe(outStream);
        outStream.resume();
        b.plugin(factor, xtend(opts, b._options, {
            e: rfiles,
            o: ss
        }));

        function resetEntry(pipeline) {
            pipeline.get('pack')
                .unshift(through.obj(function (row, enc, next) {
                    if (rfiles.indexOf(row.file) > -1) {
                        row.entry = true;
                    }
                    this.push(row);
                    next();
                }));
        }
        b.on('reset', function () {
            if (typeof opts.alterPipeline === 'function') {
                opts.alterPipeline(b.pipeline, b, true);
                b.on('factor.pipeline', function (file, pipeline) {
                    opts.alterPipeline(pipeline, b, false);
                    resetEntry(pipeline);
                });
            } else {
                b.on('factor.pipeline', function (file, pipeline) {
                    resetEntry(pipeline);
                });
            }
        });
        b.removeAllListeners('bundle');
        b.reset(opts);
        b.require(rfiles);
        b.bundle()
            .pipe(s);
        ess.on('error', function (err) {
            console.error(err);
            console.error(err.stack);
            return done();
        });
        ess.on('end', function () {
            return done();
        });
    });
    return StreamCombiner(inStream, outStream);
};
