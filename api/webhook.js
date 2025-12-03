module.exports = async (req, res) => {
  // すべてのリクエストに対して200を返す
  res.status(200).json({ message: 'OK' });
};
