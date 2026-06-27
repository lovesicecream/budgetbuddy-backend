require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ---------- CORS ----------
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
// Normalize email to lowercase before saving
UserSchema.pre('save', function (next) {
  this.email = this.email.toLowerCase();
  next();
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

const BudgetSchema = new mongoose.Schema({
  userId: String,
  category: String,
  limit: Number,
  month: String,       // format "YYYY-MM"
  spent: { type: Number, default: 0 }
});
const Budget = mongoose.model('Budget', BudgetSchema);

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

// ========== HELPER: Update budget spent ==========
async function updateBudgetSpent(userId, category, month) {
  const start = new Date(`${month}-01`);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const transactions = await Transaction.find({
    userId,
    type: 'expense',
    category,
    date: { $gte: start, $lt: end }
  });
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  await Budget.findOneAndUpdate({ userId, category, month }, { spent: total });
}

// ========== ROUTES ==========

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const email = req.body.email.toLowerCase();
    const { password, name } = req.body;
    console.log('Register attempt:', email, name);
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
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
    const email = req.body.email.toLowerCase();
    const { password } = req.body;
    console.log('Login attempt:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log('Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
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

  // Update account balance
  const account = await Account.findOne({ _id: transaction.accountId, userId: req.userId });
  if (transaction.type === 'expense') account.balance -= transaction.amount;
  else account.balance += transaction.amount;
  await account.save();

  // Update budget if expense
  if (transaction.type === 'expense') {
    const month = transaction.date.toISOString().slice(0, 7);
    await updateBudgetSpent(req.userId, transaction.category, month);
  }

  res.json(transaction);
});

// EDIT TRANSACTION (PUT)
app.put('/api/transactions/:id', auth, async (req, res) => {
  const oldTx = await Transaction.findOne({ _id: req.params.id, userId: req.userId });
  if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });

  const oldAccount = await Account.findOne({ _id: oldTx.accountId, userId: req.userId });

  // Revert old transaction's effect on account
  if (oldTx.type === 'expense') oldAccount.balance += oldTx.amount;
  else oldAccount.balance -= oldTx.amount;
  await oldAccount.save();

  // Update transaction fields
  Object.assign(oldTx, req.body);
  await oldTx.save();

  // Apply new effect
  const newAccount = await Account.findOne({ _id: oldTx.accountId, userId: req.userId });
  if (oldTx.type === 'expense') newAccount.balance -= oldTx.amount;
  else newAccount.balance += oldTx.amount;
  await newAccount.save();

  // Update budgets if expense (old and new category/month)
  if (oldTx.type === 'expense') {
    const oldMonth = oldTx.date.toISOString().slice(0, 7);
    await updateBudgetSpent(req.userId, oldTx.category, oldMonth);

    const newMonth = req.body.date ? new Date(req.body.date).toISOString().slice(0,7) : oldMonth;
    const newCategory = req.body.category || oldTx.category;
    if (newCategory !== oldTx.category || newMonth !== oldMonth) {
      await updateBudgetSpent(req.userId, newCategory, newMonth);
    }
  }

  res.json(oldTx);
});

app.delete('/api/transactions/:id', auth, async (req, res) => {
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

  const account = await Account.findOne({ _id: transaction.accountId, userId: req.userId });
  if (transaction.type === 'expense') account.balance += transaction.amount;
  else account.balance -= transaction.amount;
  await account.save();

  if (transaction.type === 'expense') {
    const month = transaction.date.toISOString().slice(0, 7);
    await updateBudgetSpent(req.userId, transaction.category, month);
  }

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

// ========== BUDGET ROUTES ==========
app.get('/api/budgets', auth, async (req, res) => {
  const budgets = await Budget.find({ userId: req.userId });
  res.json(budgets);
});

app.post('/api/budgets', auth, async (req, res) => {
  const { category, limit, month } = req.body;
  if (!category || !limit || !month) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const existing = await Budget.findOne({ userId: req.userId, category, month });
  if (existing) {
    existing.limit = limit;
    await existing.save();
    return res.json(existing);
  }

  const budget = new Budget({ userId: req.userId, category, limit, month, spent: 0 });
  await budget.save();
  res.json(budget);
});

app.delete('/api/budgets/:id', auth, async (req, res) => {
  await Budget.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ========== ONE-TIME FIX – recalculate all balances ==========
// ========== ONE‑TIME BALANCE RECALCULATION (admin) ==========
app.post('/api/admin/recalc-balances', auth, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.userId });
    const transactions = await Transaction.find({ userId: req.userId });

    for (const account of accounts) {
      let balance = 0;
      // Only transactions belonging to this account
      const tx = transactions.filter(t => t.accountId === account._id.toString());
      tx.forEach(t => {
        if (t.type === 'expense') balance -= t.amount;
        else if (t.type === 'income') balance += t.amount;
      });
      account.balance = balance;
      await account.save();
    }

    res.json({ success: true, message: 'All account balances recalculated' });
  } catch (err) {
    console.error('Recalc error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
