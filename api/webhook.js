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
  
  // GETリクエスト(ブラウザアクセス)の場合
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Bot is running!');
  }

  // 署名検証
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    console.error('No signature');
    return res.status(401).send('No signature');
  }

  // POSTリクエスト(LINEからのWebhook)の場合
  try {
    const events = req.body.events;
    console.log('Events received:', events.length);
    
    // イベント処理(まだ何もしない)
    await Promise.all(events.map(async (event) => {
      console.log('Event type:', event.type);
      
      if (event.type === 'message') {
        // テストメッセージを返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: 'Bot is working! 動作確認中です!'
          }]
        });
      }
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
