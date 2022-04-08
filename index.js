/*eslint-env node*/
'use strict';

var RSVP = require('rsvp');
var minimatch = require('minimatch');
var DeployPluginBase = require('ember-cli-deploy-plugin');
var S3 = require('./lib/s3');

var EXPIRE_IN_2030 = new Date('2030');
var TWO_YEAR_CACHE_PERIOD_IN_SEC = 60 * 60 * 24 * 365 * 2;

module.exports = {
    name: 'ember-cli-deploy-s3',

    createDeployPlugin: function(options) {
        var DeployPlugin = DeployPluginBase.extend({
            name: options.name,
            defaultConfig: {
                filePattern: '**/*.{js,css,png,gif,ico,jpg,webp,map,xml,txt,svg,swf,eot,ttf,woff,woff2,otf,wasm,json}',
                fileIgnorePattern: null,
                prefix: '',
                profile: '',
                acl: 'public-read',
                minRetryMs: 1000 * 10,
                maxRetryMs: 1000 * 60 * 5,
                maxRetries: 10,
                cacheControl: 'max-age=' + TWO_YEAR_CACHE_PERIOD_IN_SEC + ', public',
                expires: EXPIRE_IN_2030,
                dotFolders: false,
                batchSize: 0,
                defaultMimeType: 'application/octet-stream',
                distDir: function(context) {
                    return context.distDir;
                },
                distFiles: function(context) {
                    return context.distFiles || [];
                },
                gzippedFiles: function(context) {
                    return context.gzippedFiles || []; // e.g. from ember-cli-deploy-gzip
                },
                brotliCompressedFiles: function(context) {
                    return context.brotliCompressedFiles || []; // e.g. from ember-cli-deploy-gzip
                },
                manifestPath: function(context) {
                    return context.manifestPath; // e.g. from ember-cli-deploy-manifest
                },
                uploadClient: function(context) {
                    return context.uploadClient; // if you want to provide your own upload client to be used instead of one from this plugin
                },
                s3Client: function(context) {
                    return context.s3Client; // if you want to provide your own S3 client to be used instead of one from aws-sdk
                }
            },
            requiredConfig: ['bucket', 'region'],
            uploadWithRetry: function(s3, options, retryCount) {
                return new RSVP.Promise(function(resolve, reject) {
                    let resp = []
                    s3.upload(options)
                        .each(function(filesUploaded) {
                            this.log('uploaded ' + filesUploaded.length + ' files ok', {
                                verbose: true
                            });
                            resp.push({
                                filesUploaded: filesUploaded
                            })
                        })
                        .then(() => {
                            return resolve(resp)

                        })
                        .catch((err) => {
                            retryCount++
                            if (retryCount < this.readConfig('maxRetries')) {
                                setTimeout(function() {
                                        resolve(this.uploadWithRetry(s3, options, retryCount))
                                    }.bind(this),
                                    getRandomInt(this.readConfig('minRetryMs') * retryCount, this.readConfig('maxRetryMs')))

                            } else {
                                return reject(new Error(`Failed to upload files to s3 after: ${retryCount} retries. ${err||''}`))
                            }
                        })
                }.bind(this))
            },
            upload: function() {
                var filePattern = this.readConfig('filePattern');
                var fileIgnorePattern = this.readConfig('fileIgnorePattern');
                var distDir = this.readConfig('distDir');
                var distFiles = this.readConfig('distFiles');
                var gzippedFiles = this.readConfig('gzippedFiles');
                var brotliCompressedFiles = this.readConfig('brotliCompressedFiles');
                var bucket = this.readConfig('bucket');
                var acl = this.readConfig('acl');
                var prefix = this.readConfig('prefix');
                var manifestPath = this.readConfig('manifestPath');
                var cacheControl = this.readConfig('cacheControl');
                var expires = this.readConfig('expires');
                var dotFolders = this.readConfig('dotFolders');
                var serverSideEncryption = this.readConfig('serverSideEncryption');
                var batchSize = this.readConfig('batchSize');
                var defaultMimeType = this.readConfig('defaultMimeType');

                var filesToUpload = distFiles.filter(minimatch.filter(filePattern, {
                    matchBase: true,
                    dot: dotFolders
                }));
                if (fileIgnorePattern) {
                    filesToUpload = filesToUpload.filter(function(path) {
                        return !minimatch(path, fileIgnorePattern, {
                            matchBase: true
                        });
                    });
                    gzippedFiles = gzippedFiles.filter(function(path) {
                        return !minimatch(path, fileIgnorePattern, {
                            matchBase: true
                        });
                    });
                    brotliCompressedFiles = brotliCompressedFiles.filter(function(path) {
                        return !minimatch(path, fileIgnorePattern, {
                            matchBase: true
                        });
                    });
                }

                var s3 = this.readConfig('uploadClient') || new S3({
                    plugin: this
                });

                var options = {
                    cwd: distDir,
                    filePaths: filesToUpload,
                    gzippedFilePaths: gzippedFiles,
                    brotliCompressedFilePaths: brotliCompressedFiles,
                    prefix: prefix,
                    bucket: bucket,
                    acl: acl,
                    manifestPath: manifestPath,
                    cacheControl: cacheControl,
                    expires: expires,
                    batchSize: batchSize,
                    defaultMimeType: defaultMimeType
                };

                if (serverSideEncryption) {
                    options.serverSideEncryption = serverSideEncryption;
                }

                this.log('preparing to upload to S3 bucket `' + bucket + '`', {
                    verbose: true
                });
                return this.uploadWithRetry(s3, options, 0)
            },
            _errorMessage: function(error) {
                this.log(error, {
                    color: 'red'
                });
                if (error) {
                    this.log(error.stack, {
                        color: 'red'
                    });
                }
                return RSVP.reject(error);
            }
        });
        return new DeployPlugin();
    }
};

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}
