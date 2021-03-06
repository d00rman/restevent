"use strict";


var P     = require('bluebird');
var util  = require('util');
var sUtil = require('./util');


// XXX: These interfaces are fairly Kafka-cetric and will require more thought.


/**
 * The base class for Producer implementations.
 *
 * @param {object} params; the parameters needed to instantiate a Producer
 * @constructor
 */
function Producer(params) {
    this.conf = params.conf;
    this.logger = params.logger;
}

/**
 * Send a list of messages to the underlying queue.
 *
 * Each item in {messages} is an object that represents the destination topic,
 * and one or messages to queue.  For example:
 *
 * @example
 * [
 *   {
 *     topic:       'topicName',
 *     messages:    [ msg, msg, ... ],
 *     partition:   0,
 *     attributes:  2
 *   },
 *   ...
 * ]
 *
 * @param   {array} messages; the list of messages to send to the queue
 * @return {object} a promise that resolves to the status of the send
 */
Producer.prototype.sendBatch = function(messages) {
    throw new Error('not implemented; you must override Producer#send');
};

/**
 * Attempts to create the given topics one by one
 *
 * @param {Array} topics; the list of topics to create
 */
Producer.prototype.createTopics = function(topics) {
    throw new Error('not implemented; you must override Producer#createTopics');
};


/**
 * Producer implementation based on Kafka.
 *
 * @extends {Producer}
 * @constructor
 */
function KafkaProducer(params) {
    Producer.call(this, params);

    var kOpts = {};
    var host = this.conf.provider.host || 'localhost';
    var port = this.conf.provider.port || 2181;
    kOpts.connectionString = host + ':' + port;
    kOpts.clientId = this.conf.client || "surge";
    kOpts.zkOpts = {}; // Zookeeper connection options (see: http://git.io/vCKRh)

    var kafka = P.promisifyAll(require('kafka-node'));
    this.client = new kafka.Client(kOpts.connectionString, kOpts.clientId, kOpts.zkOpts);
    this.producer = new kafka.HighLevelProducer(this.client);

    var self = this;

    // A promise that resolves only after the 'ready' and 'connect' events fire
    this.ready = P.join(
        new P(function(resolve) { self.client.on('connect', resolve); }),
        new P(function(resolve) { self.producer.on('ready', resolve); })
    ).then(function() {
        self.logger.log('info/kafka/init', 'kafka producer is ready');
    });

    // log any error events
    this.producer.on('error', function(errMsg) {
        self.logger.log('error/kafka', errMsg);
    });
}

util.inherits(KafkaProducer, Producer);

/** @inheritdoc */
KafkaProducer.prototype.sendBatch = function(batch) {
    var self = this;
    if (!Array.isArray(batch)) {
        throw new sUtil.HTTPError({
            status: 400,
            type: 'invalid_request',
            title: 'Wrong batch format',
            detail: 'When sending messages in batches, they are expected to be in an array'
        });
    }
    batch = batch.map(function(msg) {
        return {
            topic: msg.topic,
            // Use JSON serialization
            messages: msg.messages.map(JSON.stringify),
            // Enable snappy compression
            attributes: 2
        };
    });
    self.logger.log('trace/kafka/send', { payload: batch });
    return self.producer.sendAsync(batch);
};

/** @inheritdoc */
KafkaProducer.prototype.createTopics = function(topics) {

    var self = this;

    if (!Array.isArray(topics)) {
        topics = [topics];
    }

    return P.each(topics, function(t) {
        self.logger.log('info/topic/create', 'Creating topic ' + t);
        return self.client.createTopicsAsync([t]);
    });

};


/** Returns a Producer implementation based on the configuration. */
function getProducer(params) {
    var type = params.conf.provider.type;
    switch (type) {
    case 'kafka':
        var kafkaProd = new KafkaProducer(params);
        return kafkaProd.ready.then(function() {
            return kafkaProd;
        });
    default:
        throw new Error('unrecognized provider type \'' + type + '\'');
    }
}


module.exports = {
    getProducer: getProducer
};
