const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

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

// Passport initialization
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(require('express-session')({ secret: 'your-secret-key', resave: true, saveUninitialized: true }));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(
  async function (username, password, done) {
    try {
      // Replace this with your actual user authentication logic
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

      if (result.rows.length === 0) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      const user = result.rows[0];

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (isPasswordValid) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Incorrect password.' });
      }
    } catch (error) {
      return done(error);
    }
  }
));

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(async function (id, done) {
  try {
    // Replace this with your actual user retrieval logic
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return done(null, false);
    }

    const user = result.rows[0];
    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

// isAuthenticated middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    const userRole = req.user.role;

    // Allow access based on user role
    switch (userRole) {
      case 'admin':
        if (req.path === '/moderator.html') {
          console.log('Unauthorized access!');
          return res.redirect('/login');
        }
        console.log('Authenticated admin:', req.user);
        return next();
      case 'moderator':
        console.log('Authenticated moderator:', req.user);
        return next();
      case 'user':
        // Ensure that the user can only access their own page
        if (req.path !== `/${userRole}.html`) {
          console.log('Unauthorized access!');
          return res.redirect('/login');
        }
        console.log('Authenticated user:', req.user);
        return next();
      default:
        console.log('Unauthorized access!');
        return res.redirect('/login');
    }
  }

  console.log('Not authenticated!');
  res.redirect('/login'); // Redirect to the login page if not authenticated
}

// Routes
app.post('/api/auth/signin',
  passport.authenticate('local', { failureRedirect: '/login.html' }),
  function (req, res) {
    // Authentication successful, handle the response based on user role
    switch (req.user.role) {
      case 'admin':
        res.redirect('/admin.html');
        break;
      case 'moderator':
        res.redirect('/moderator.html');
        break;
      case 'user':
        res.redirect('/user.html');
        break;
      default:
        res.redirect('/'); // Redirect to a default page if the role is not recognized
    }
  });


app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = 'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *';
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
  req.logout();
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

app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});


app.get('/user.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'user.html'));
});

app.get('/admin.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/moderator.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'moderator.html'));
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
