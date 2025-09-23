const { PubSub } = require('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');

// Initialize clients
const pubsub = new PubSub();
const firestore = new Firestore();

/**
 * Google Calendar Webhook handler function
 * Responds to push notifications from the Calendar API
 */
exports.handleCalendarWebhook = async (req, res) => {
  try {
    console.log('Received Calendar webhook:', {
      headers: req.headers,
      body: req.body
    });

    // Validate webhook token
    const token = req.headers['x-goog-channel-token'];
    if (token !== process.env.WEBHOOK_TOKEN) {
      console.error('Invalid webhook token');
      return res.status(401).send('Unauthorized');
    }

    // Get notification information
    const channelId = req.headers['x-goog-channel-id'];
    const resourceId = req.headers['x-goog-resource-id'];
    const resourceUri = req.headers['x-goog-resource-uri'];
    const resourceState = req.headers['x-goog-resource-state'];

    // Record event to Firestore
    const eventDoc = {
      type: 'calendar_change',
      channelId,
      resourceId,
      resourceUri,
      resourceState,
      timestamp: new Date(),
      processed: false
    };

    await firestore.collection('calendar_events').add(eventDoc);

    // Publish to Pub/Sub for the Agent Brain to process
    const message = {
      type: 'CALENDAR_CHANGE',
      data: eventDoc,
      timestamp: new Date().toISOString()
    };

    const topic = pubsub.topic('agent-events');
    await topic.publishMessage({
      data: Buffer.from(JSON.stringify(message)),
      attributes: {
        eventType: 'calendar_change',
        source: 'calendar_webhook'
      }
    });

    console.log('Calendar event processed and sent to Agent Brain');
    res.status(200).send('OK');

  } catch (error) {
    console.error('Failed to process Calendar webhook:', error);
    
    // Record error to Firestore
    await firestore.collection('webhook_errors').add({
      type: 'calendar_webhook_error',
      error: error.message,
      stack: error.stack,
      timestamp: new Date(),
      headers: req.headers,
      body: req.body
    });

    res.status(500).send('Internal Server Error');
  }
};

/**
 * Gmail Push Notification handler function
 */
exports.handleGmailWebhook = async (req, res) => {
  try {
    console.log('Received Gmail webhook:', {
      body: req.body
    });

    const message = req.body.message;
    if (!message) {
      return res.status(400).send('No message found');
    }

    // Decode Pub/Sub message
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    
    console.log('Gmail notification data:', data);

    // Process email change event
    const eventDoc = {
      type: 'gmail_change',
      historyId: data.historyId,
      emailAddress: data.emailAddress,
      timestamp: new Date(),
      processed: false
    };

    await firestore.collection('gmail_events').add(eventDoc);

    // Publish to Agent event topic
    const agentMessage = {
      type: 'GMAIL_CHANGE',
      data: eventDoc,
      timestamp: new Date().toISOString()
    };

    const topic = pubsub.topic('agent-events');
    await topic.publishMessage({
      data: Buffer.from(JSON.stringify(agentMessage)),
      attributes: {
        eventType: 'gmail_change',
        source: 'gmail_webhook'
      }
    });

    console.log('Gmail event processed and sent to Agent Brain');
    res.status(200).send('OK');

  } catch (error) {
    console.error('Failed to process Gmail webhook:', error);
    
    await firestore.collection('webhook_errors').add({
      type: 'gmail_webhook_error',
      error: error.message,
      stack: error.stack,
      timestamp: new Date(),
      body: req.body
    });

    res.status(500).send('Internal Server Error');
  }
};

/**
 * Scheduled task - Agent health check
 */
exports.agentHealthCheck = async (req, res) => {
  try {
    console.log('Executing Agent health check...');

    const healthData = {
      timestamp: new Date(),
      status: 'checking',
      services: {}
    };

    // Check Firestore connection
    try {
      await firestore.collection('health_check').doc('test').set({
        timestamp: new Date()
      });
      healthData.services.firestore = 'healthy';
    } catch (error) {
      healthData.services.firestore = 'unhealthy';
      console.error('Firestore health check failed:', error);
    }

    // Check Pub/Sub connection
    try {
      const topic = pubsub.topic('agent-events');
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify({
          type: 'HEALTH_CHECK',
          timestamp: new Date().toISOString()
        }))
      });
      healthData.services.pubsub = 'healthy';
    } catch (error) {
      healthData.services.pubsub = 'unhealthy';
      console.error('Pub/Sub health check failed:', error);
    }

    // Update overall status
    healthData.status = Object.values(healthData.services).every(s => s === 'healthy') 
      ? 'healthy' 
      : 'degraded';

    // Record health check result
    await firestore.collection('health_checks').add(healthData);

    console.log('Agent health check completed:', healthData);
    
    if (res) {
      res.status(200).json(healthData);
    }

  } catch (error) {
    console.error('Agent health check failed:', error);
    
    if (res) {
      res.status(500).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      });
    }
  }
};

/**
 * Scheduled task - Clean up expired data
 */
exports.cleanupExpiredData = async (req, res) => {
  try {
    console.log('Starting cleanup of expired data...');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago

    let deletedCount = 0;

    // Clean up expired webhook error records
    const errorQuery = await firestore
      .collection('webhook_errors')
      .where('timestamp', '<', cutoffDate)
      .get();

    const batch = firestore.batch();
    errorQuery.forEach(doc => {
      batch.delete(doc.ref);
      deletedCount++;
    });

    if (deletedCount > 0) {
      await batch.commit();
    }

    console.log(`Cleanup complete, deleted ${deletedCount} expired records`);

    if (res) {
      res.status(200).json({
        message: 'Cleanup completed',
        deletedCount,
        timestamp: new Date()
      });
    }

  } catch (error) {
    console.error('Failed to clean up expired data:', error);
    
    if (res) {
      res.status(500).json({
        error: error.message,
        timestamp: new Date()
      });
    }
  }
};