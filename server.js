require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- MongoDB ----------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// ---------- Models ----------
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  name: String
});
const User = mongoose.model('User', UserSchema);

const AccountSchema = new mongoose.Schema({
  userId: String,
  name: String,
  type: String,
  balance: Number,
  currency: String,
  icon: String,
  color: String
});
const Account = mongoose.model('Account', AccountSchema);

const TransactionSchema = new mongoose.Schema({
  userId: String,
  accountId: String,
  type: String,
  amount: Number,
  category: String,
  note: String,
  date: Date
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const DebtSchema = new mongoose.Schema({
  userId: String,
  counterpartyName: String,
  type: String,
  amount: Number,
  paidAmount: { type: Number, default: 0 },
  description: String,
  dueDate: Date,
  status: { type: String, default: 'pending' }
});
const Debt = mongoose.model('Debt', DebtSchema);

// ---------- Auth middleware ----------
const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ---------- Routes ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashed, name });
    await user.save();
    res.json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
  res.json({ token, userId: user._id, name: user.name });
});

// Accounts
app.get('/api/accounts', auth, async (req, res) => {
  const accounts = await Account.find({ userId: req.userId });
  res.json(accounts);
});
app.post('/api/accounts', auth, async (req, res) => {
  const account = new Account({ ...req.body, userId: req.userId });
  await account.save();
  res.json(account);
});
app.put('/api/accounts/:id', auth, async (req, res) => {
  const account = await Account.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  res.json(account);
});
app.delete('/api/accounts/:id', auth, async (req, res) => {
  await Account.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// Transactions
app.get('/api/transactions', auth, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.userId }).sort({ date: -1 });
  res.json(transactions);
});
app.post('/api/transactions', auth, async (req, res) => {
  const transaction = new Transaction({ ...req.body, userId: req.userId });
  await transaction.save();
  const account = await Account.findOne({ _id: transaction.accountId, userId: req.userId });
  if (transaction.type === 'expense') account.balance -= transaction.amount;
  else account.balance += transaction.amount;
  await account.save();
  res.json(transaction);
});
app.delete('/api/transactions/:id', auth, async (req, res) => {
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  const account = await Account.findOne({ _id: transaction.accountId, userId: req.userId });
  if (transaction.type === 'expense') account.balance += transaction.amount;
  else account.balance -= transaction.amount;
  await account.save();
  res.json({ success: true });
});

// Debts
app.get('/api/debts', auth, async (req, res) => {
  const debts = await Debt.find({ userId: req.userId });
  res.json(debts);
});
app.post('/api/debts', auth, async (req, res) => {
  const debt = new Debt({ ...req.body, userId: req.userId });
  await debt.save();
  res.json(debt);
});
app.put('/api/debts/:id', auth, async (req, res) => {
  const debt = await Debt.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  res.json(debt);
});
app.delete('/api/debts/:id', auth, async (req, res) => {
  await Debt.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));