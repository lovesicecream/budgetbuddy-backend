require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// ========== MODELS ==========
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  name: { type: String, required: true }
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

// ========== AUTH MIDDLEWARE ==========
const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== ROUTES ==========

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    console.log('Register attempt:', email, name);
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({ email, password: hashedPassword, name });
    await user.save();
    
    console.log('User registered:', email);
    res.json({ message: 'User created successfully' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt:', email);
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Compare password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log('Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('Login successful:', email);
    res.json({ token, userId: user._id, name: user.name });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========== ACCOUNT ROUTES ==========
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

// ========== TRANSACTION ROUTES ==========
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

// ========== DEBT ROUTES ==========
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

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));