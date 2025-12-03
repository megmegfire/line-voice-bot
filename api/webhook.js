module.exports = async (req, res) => {
  console.log('Webhook called');
  console.log('Method:', req.method);
  
  // POSTリクエストの場合
  if (req.method === 'POST') {
    return res.status(200).json({ message: 'OK' });
  }
  
  // GETリクエストの場合
  return res.status(200).send('Webhook endpoint is working!');
};
