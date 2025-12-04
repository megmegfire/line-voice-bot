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

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

// 使用状況トラッキング
const usageTracking = {
  daily: 0,
  total: 0,
  lastReset: new Date().toDateString(),
  audioCount: 0,
  transcriptionCount: 0,
  transcriptionMinutes: 0
};

// ユーザーの音声ファイル情報を一時保存
const userAudioCache = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Audio Bot is running! 🎵📝');
  }

  try {
    const events = req.body.events;
    
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    await Promise.all(events.map(async (event) => {
      if (event.type === 'message') {
        const userId = event.source.userId;
        
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
                text: '🎵📝 音声処理Bot\n\n' +
                      '【使い方】\n' +
                      '1. 音声メッセージを送信\n' +
                      '2. 処理方法を選択:\n' +
                      '   ・速度変更してダウンロード\n' +
                      '   ・文字起こし\n\n' +
                      '【機能】\n' +
                      '🎵 速度変更: 1.0〜2.0倍速\n' +
                      '📝 文字起こし: 月180分無料\n' +
                      '💾 保存期限: なし\n\n' +
                      '【コマンド】\n' +
                      '📊 利用状況 → 利用統計\n' +
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
                      `【今日】\n` +
                      `処理回数: ${usageTracking.daily}回\n\n` +
                      `【合計】\n` +
                      `総処理回数: ${usageTracking.total}回\n` +
                      `保存音声数: ${usageTracking.audioCount}件\n` +
                      `文字起こし: ${usageTracking.transcriptionCount}回\n` +
                      `文字起こし時間: ${usageTracking.transcriptionMinutes.toFixed(1)}分\n` +
                      `残り無料枠: ${(180 - usageTracking.transcriptionMinutes).toFixed(1)}分/月`
              }]
            });
            return;
          }

          // 速度選択の処理
          if (['1.0', '1.5', '2.0'].includes(text)) {
            const speed = parseFloat(text);
            const cachedAudio = userAudioCache[userId];
            
            if (!cachedAudio) {
              await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                  type: 'text',
                  text: '⚠️ 音声ファイルが見つかりません。\n先に音声メッセージを送信してください。'
                }]
              });
              return;
            }

            // 処理中メッセージ
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: `🎵 ${speed}倍速で処理中です...\n少々お待ちください`
              }]
            });

            try {
              const publicId = cachedAudio.publicId;
              const duration = cachedAudio.duration;
              
              let speedUrl;
              if (speed === 1.0) {
                speedUrl = cachedAudio.originalUrl;
              } else {
                const accelerateValue = Math.round((1 / speed) * 100);
                speedUrl = cloudinary.url(publicId, {
                  resource_type: 'video',
                  effect: `accelerate:${accelerateValue}`,
                  format: 'm4a'
                });
              }

              const adjustedDuration = Math.floor(duration / speed);
              const speedLabel = speed === 1.0 ? '📢 通常' :
                                speed === 1.5 ? '🚀 速い' :
                                '⚡ 超速';

              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `✅ ${speedLabel} (${speed}倍速) 準備完了!\n\n` +
                        `【ダウンロードリンク】\n${speedUrl}\n\n` +
                        `元の長さ: ${Math.floor(duration)}秒\n` +
                        `変換後: 約${adjustedDuration}秒\n` +
                        `形式: m4a\n\n` +
                        `💡 上のリンクをタップしてダウンロードできます！\n\n` +
                        `別の速度で試す場合は、もう一度速度を選択してください。`
                }]
              });

            } catch (error) {
              console.error('速度変更エラー:', error);
              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `❌ エラー: ${error.message}\n\n再度お試しください`
                }]
              });
            }
            return;
          }

          // 文字起こし処理
          if (text === '文字起こし') {
            const cachedAudio = userAudioCache[userId];
            
            if (!cachedAudio) {
              await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                  type: 'text',
                  text: '⚠️ 音声ファイルが見つかりません。\n先に音声メッセージを送信してください。'
                }]
              });
              return;
            }

            usageTracking.transcriptionCount++;

            // 処理中メッセージ
            await client.replyMessage({
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: '📝 文字起こし中です...\n約30秒〜2分お待ちください'
              }]
            });

            try {
              const audioUrl = cachedAudio.originalUrl;
              const duration = cachedAudio.duration;

              // AssemblyAI: 文字起こしをリクエスト
              const transcriptResponse = await axios.post(
                'https://api.assemblyai.com/v2/transcript',
                {
                  audio_url: audioUrl,
                  language_code: 'ja',
                  speech_model: 'best'
                },
                {
                  headers: {
                    authorization: ASSEMBLYAI_API_KEY,
                    'content-type': 'application/json'
                  }
                }
              );

              const transcriptId = transcriptResponse.data.id;

              // ポーリング: 処理完了まで待機
              let transcript;
              let attempts = 0;
              const maxAttempts = 60;

              while (attempts < maxAttempts) {
                const pollingResponse = await axios.get(
                  `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
                  {
                    headers: { authorization: ASSEMBLYAI_API_KEY }
                  }
                );

                transcript = pollingResponse.data;

                if (transcript.status === 'completed') {
                  break;
                } else if (transcript.status === 'error') {
                  throw new Error('文字起こしエラー: ' + transcript.error);
                }

                await new Promise(resolve => setTimeout(resolve, 5000));
                attempts++;
              }

              if (!transcript || transcript.status !== 'completed') {
                throw new Error('文字起こしがタイムアウトしました');
              }

              const transcribedText = transcript.text;

              // 使用時間を記録
              const audioMinutes = duration / 60;
              usageTracking.transcriptionMinutes += audioMinutes;

              // 結果を送信
              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `✅ 文字起こし完了!\n\n` +
                        `【全文】\n${transcribedText}\n\n` +
                        `処理時間: ${audioMinutes.toFixed(1)}分\n` +
                        `残り無料枠: ${(180 - usageTracking.transcriptionMinutes).toFixed(1)}分/月`
                }]
              });

            } catch (error) {
              console.error('文字起こしエラー:', error);
              await client.pushMessage({
                to: userId,
                messages: [{
                  type: 'text',
                  text: `❌ エラー: ${error.message}\n\n短い音声で再度お試しください`
                }]
              });
            }
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
              text: '🎵 音声をアップロード中です...\n少々お待ちください'
            }]
          });

          try {
            const messageId = event.message.id;
            const duration = (event.message.duration || 0) / 1000;
            
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
                  resource_type: 'video',
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
            const publicId = uploadResult.public_id;

            // ユーザーの音声情報をキャッシュ
            userAudioCache[userId] = {
              publicId: publicId,
              originalUrl: audioUrl,
              duration: duration,
              timestamp: Date.now()
            };

            // 処理方法選択ボタンを送信
            await client.pushMessage({
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `✅ 音声アップロード完了!\n\n` +
                        `長さ: ${Math.floor(duration)}秒\n` +
                        `形式: m4a\n\n` +
                        `処理方法を選択してください:`
                },
                {
                  type: 'template',
                  altText: '処理方法を選択してください',
                  template: {
                    type: 'buttons',
                    text: '何をしますか？',
                    actions: [
                      {
                        type: 'message',
                        label: '📝 文字起こし',
                        text: '文字起こし'
                      },
                      {
                        type: 'message',
                        label: '📢 1.0倍速 (通常)',
                        text: '1.0'
                      },
                      {
                        type: 'message',
                        label: '🚀 1.5倍速 (速い)',
                        text: '1.5'
                      },
                      {
                        type: 'message',
                        label: '⚡ 2.0倍速 (超速)',
                        text: '2.0'
                      }
                    ]
                  }
                }
              ]
            });

          } catch (audioError) {
            console.error('音声処理エラー:', audioError);
            await client.pushMessage({
              to: userId,
              messages: [{
                type: 'text',
                text: `❌ エラー: ${audioError.message}\n\n再度お試しください`
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
