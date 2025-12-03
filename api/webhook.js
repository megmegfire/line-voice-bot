const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// 設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 使用回数トラッキング(簡易版)
const usageTracker = {};

module.exports = async (req, res) => {
  // GETリクエスト
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Bot is running!');
  }

  try {
    const events = req.body.events;
    
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    await Promise.all(events.map(async (event) => {
      const userId = event.source.userId;

      // テキストメッセージの処理
      if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text;

        if (text === 'ヘルプ' || text === 'help') {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: '🎤 音声メッセージ文字起こしBot\n\n使い方:\n1. 音声メッセージを送信\n2. 自動で文字起こし・要約します\n\n利用状況を確認: 「利用状況」と送信'
            }]
          });
          return;
        }

        if (text === '利用状況') {
          const usage = usageTracker[userId] || { count: 0 };
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: `📊 利用状況\n\n今月の利用回数: ${usage.count}回\n月間上限: 1500回(無料)\n残り: ${1500 - usage.count}回`
            }]
          });
          return;
        }

        // 通常のテキストメッセージへの返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '音声メッセージを送信してください🎤'
          }]
        });
      }

      // 音声メッセージの処理
      if (event.type === 'message' && event.message.type === 'audio') {
        // 使用回数チェック
        if (!usageTracker[userId]) {
          usageTracker[userId] = { count: 0 };
        }

        if (usageTracker[userId].count >= 1500) {
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: '⚠️ 月間利用上限(1500回)に達しました'
            }]
          });
          return;
        }

        // 処理開始通知
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '🎤 音声を処理中です...\nGemini APIをテスト中...'
          }]
        });

        try {
          // Gemini APIのテスト
          console.log('Testing Gemini API...');
          const testModel = genAI.getGenerativeModel({ 
  model: 'models/gemini-1.5-flash-latest' 
});
          const testResult = await testModel.generateContent('Hello');
          console.log('✅ Gemini API works! Response:', testResult.response.text());

          // テスト成功メッセージ
          await client.pushMessage({
            to: userId,
            messages: [{
              type: 'text',
              text: '✅ Gemini APIキーは正常です!\n\n次のステップで音声処理を実装します。'
            }]
          });

          usageTracker[userId].count++;

        } catch (error) {
          console.error('Gemini API test failed:', error);
          await client.pushMessage({
            to: userId,
            messages: [{
              type: 'text',
              text: '❌ Gemini APIエラー\n\n' + error.message + '\n\nAPIキーを確認してください。'
            }]
          });
        }
      }
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    return res.status(200).json({ error: err.message });
  }
};
