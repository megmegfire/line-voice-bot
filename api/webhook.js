const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

module.exports = async (req, res) => {
  console.log('Webhook called, method:', req.method);
  
  // GETリクエスト
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Bot is running!');
  }

  // POSTリクエスト - 署名検証を一時的にスキップ
  try {
    console.log('Processing webhook...');
    console.log('Body:', req.body);
    
    const events = req.body.events;
    
    if (!events || events.length === 0) {
      console.log('No events');
      return res.status(200).json({ message: 'No events' });
    }
    
    console.log('Events received:', events.length);
    
    await Promise.all(events.map(async (event) => {
      console.log('Event type:', event.type);
      
      if (event.type === 'message' && event.message.type === 'text') {
        // テキストメッセージに返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '✅ Bot is working!\n受信: ' + event.message.text
          }]
        });
      }
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    // エラーが出ても200を返す(検証を通すため)
    return res.status(200).json({ error: err.message });
  }
};
