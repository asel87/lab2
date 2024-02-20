const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');
// Example API endpoint for fetching books
const apiEndpoint = '/api/books';


const app = express();

const port = 3000;
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: 'asel3127',
  port: 5433,
});


function checkUserRole(req, res, next) {
  const userRole = req.user.role;

  if (userRole === 'user') {
    res.redirect('/user.html');
  } else if (userRole === 'admin') {
    res.redirect('/admin.html');
  } else if (userRole === 'moderator') {
    res.redirect('/moderator.html');
  } else {
    res.status(403).send('Unauthorized');
  }

  // Call next() to continue the middleware chain
  next();
}


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/auth/signin', async (req, res, next) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = $1';
  const values = [username];

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).send('User not found');
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (isPasswordValid) {
      req.user = user;
      checkUserRole(req, res, next); 
    } else {
      return res.status(401).send('Invalid password');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error login user');
  }
});

app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query =
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *';
    const values = [username, email, hashedPassword, role];

    const result = await pool.query(query, values);

    req.user = result.rows[0];
    next();

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).send('Error registering user');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.redirect('/login.html');
});

app.get('/api/books', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/borrow', async (req, res) => {
  const { userName, bookTitle } = req.body;

  // Find the book by title and remove it from the list of available books
  await pool.query('DELETE FROM books WHERE title = $1', [bookTitle]);

  // Add the borrowed book to the borrowings table
  await pool.query('INSERT INTO borrowings (user_name, book_title) VALUES ($1, $2)', [userName, bookTitle]);

  res.json({ message: 'Book borrowed successfully' });
});
app.get('/api/available-books', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books WHERE NOT EXISTS (SELECT 1 FROM borrowings WHERE books.title = borrowings.book_title)');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching available books:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.post('/api/borrowings', async (req, res) => {
  try {
    const { userName, bookTitle } = req.body;

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [userName]);
    const bookResult = await pool.query('SELECT * FROM books WHERE title = $1', [bookTitle]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const borrowResult = await pool.query(
      'INSERT INTO borrowings (user_name, book_title) VALUES ($1, $2) RETURNING *',
      [userName, bookTitle]
    );

    res.status(200).json({ message: 'Book borrowed successfully', borrowing: borrowResult.rows[0] });
  } catch (error) {
    console.error('Borrowing error:', error);
    res.status(500).json({ error: 'Failed to borrow book' });
  }
});

app.get('/api/books/:id', async (req, res) => {
  const bookId = req.params.id;
  try {
    const result = await pool.query('SELECT * FROM books WHERE id = $1', [bookId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Book not found' });
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({ error: 'Error fetching book' });
  }
});

app.post('/api/books', async (req, res) => {
  const { title, author, genre } = req.body;
  try {
    const result = await pool.query('INSERT INTO books (title, author, genre) VALUES ($1, $2, $3) RETURNING *', [
      title,
      author,
      genre,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding book:', error);
    res.status(500).json({ error: 'Error adding book' });
  }
});

app.put('/api/books/:id', async (req, res) => {
  const bookId = req.params.id;
  const { title, author, genre } = req.body;
  try {
    const result = await pool.query(
      'UPDATE books SET title = $1, author = $2, genre = $3 WHERE id = $4 RETURNING *',
      [title, author, genre, bookId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ error: 'Error updating book' });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  const bookId = req.params.id;
  try {
    const result = await pool.query('DELETE FROM books WHERE id = $1 RETURNING *', [bookId]);
    res.json({ message: 'Book deleted successfully', book: result.rows[0] });
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).json({ error: 'Error deleting book' });
  }
});

app.post('/api/admin/adduser', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query =
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *';
    const values = [username, email, hashedPassword, role];

    const result = await pool.query(query, values);

    res.status(200).json({ message: 'User added successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to add user' });
  }
});

app.delete('/api/admin/deleteuser', async (req, res) => {
  try {
    const { userIdToDelete } = req.body;

    const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
    const values = [userIdToDelete];

    const result = await pool.query(query, values);

    res.status(200).json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/books.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'books.html'));
});

app.get('/add_books.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'add_books.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/user.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'user.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/moderator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'moderator.html'));
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});