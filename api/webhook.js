const line = require('@line/bot-sdk');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// Cloudinary設定
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 使用状況トラッキング
const usageTracking = {
  daily: 0,
  total: 0,
  lastReset: new Date().toDateString(),
  audioCount: 0
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Audio Download Bot is running! 🎵');
  }

  try {
    const events = req.body.events;
    
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    await Promise.all(events.map(async (event) => {
      if (event.type === 'message') {
        // 使用状況リセット
        const today = new Date().toDateString();
        if (usageTracking.lastReset !== today) {
          usageTracking.daily = 0;
          usageTracking.lastReset = today;
        }

        // テキストメッセージ処理
        if (event.message.type === 'text') {
          const text = event.message.text.trim();
          
          if (text === 'ヘルプ' || text === 'help') {
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: '🎵 音声ダウンロードBot\n\n' +
                      '【使い方】\n' +
                      '1. 音声メッセージを送信\n' +
                      '2. ダウンロードリンクが届く\n' +
                      '3. リンクをタップしてダウンロード\n\n' +
                      '【対応形式】\n' +
                      '・m4a (LINE音声)\n' +
                      '・保存期限なし\n\n' +
                      '【コマンド】\n' +
                      '📊 利用状況 → 今日/合計の利用状況\n' +
                      '❓ ヘルプ → この画面'
              }]
            });
            return;
          }

          if (text === '利用状況') {
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: `📊 利用状況\n\n` +
                      `今日: ${usageTracking.daily}回\n` +
                      `合計: ${usageTracking.total}回\n` +
                      `保存音声数: ${usageTracking.audioCount}件`
              }]
            });
            return;
          }
        }

        // 音声メッセージ処理
        if (event.message.type === 'audio') {
          usageTracking.daily++;
          usageTracking.total++;
          usageTracking.audioCount++;

          // 処理中メッセージ
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: '🎵 音声を処理中です...\n少々お待ちください'
            }]
          });

          try {
            const messageId = event.message.id;
            const duration = event.message.duration || 0;
            
            // 音声ファイルをダウンロード
            const audioResponse = await axios.get(
              `https://api-data.line.me/v2/bot/message/${messageId}/content`,
              {
                headers: {
                  Authorization: `Bearer ${config.channelAccessToken}`
                },
                responseType: 'arraybuffer'
              }
            );

            const audioBuffer = Buffer.from(audioResponse.data);
            
            // Cloudinaryにアップロード
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  resource_type: 'video', // 音声ファイルも'video'として扱う
                  format: 'm4a',
                  public_id: `line_audio_${messageId}`,
                  folder: 'line_audio'
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );
              uploadStream.end(audioBuffer);
            });

            const audioUrl = uploadResult.secure_url;
            const durationSec = Math.floor(duration / 1000);

            // 結果を送信
            await client.pushMessage({
              to: event.source.userId,
              messages: [{
                type: 'text',
                text: `✅ 音声ファイル準備完了!\n\n` +
                      `【ダウンロードリンク】\n${audioUrl}\n\n` +
                      `長さ: ${durationSec}秒\n` +
                      `形式: m4a\n\n` +
                      `💡 上のリンクをタップしてダウンロードできます！`
              }]
            });

          } catch (audioError) {
            console.error('音声処理エラー:', audioError);
            await client.pushMessage({
              to: event.source.userId,
              messages: [{
                type: 'text',
                text: `❌ エラー: ${audioError.message}\n\n` +
                      '再度お試しください'
              }]
            });
          }
        }
      }
    }));

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(200).json({ error: err.message });
  }
};