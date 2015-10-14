'use strict';

var P = require('bluebird');
var sUtil = require('../lib/util');


// shortcut
var HTTPError = sUtil.HTTPError;

/**
 * The main router object
 */
var router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
var app;

/*
 * Expected layout
 * {
 *    topic: 'topicName',
 *    messages: ['message body'],// multi messages should be a array, single message can be just a string or a KeyedMessage instance
 *    // These might be best controlled by the proxy
 *    partition: 0, //default 0
 *    attributes: 2, // 0 is none, 1 gzip, 2 snappy (default: 0)
 * }
 */
function validateMessages(topic, messages) {
    messages = messages.map(function(msg) {
        if (!app.schemaValidator.validate(topic, msg)) {
            throw new HTTPError({
                status: 400,
                body: {
                    type: 'invalid_message',
                    original_message: msg,
                    validation_error: app.schemaValidator.errors,
                }
            });
        }
        return JSON.stringify(msg);
    });
    return {
        topic: topic,
        messages: messages,
        attributes: 2, // snappy compression
    };
}


/**
 * POST /topics/{name}/
 * Enqueue one or more events. Each event needs to conform to the JSON schema
 * associated with this topic.
 */
router.post('/topics/:name', function(req, res) {
    return P.try(function() {
        var message = validateMessages(req.params.name, req.body);
        return app.producer.send([message]);
    })
    .then(function(ret) {
        res.status(200).send('Message enqueued');
    });
});



module.exports = function(appObj) {

    app = appObj;

    return {
        path: '/',
        api_version: 1,
        router: router
    };
};
