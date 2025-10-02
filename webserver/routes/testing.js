import express from 'express';
import {requireLogin} from "../auth/auth.js";

const router = express.Router();
// test für session
router.get('/',requireLogin, (req, res) => {
    console.log("Hello World has been sent.")
    res.status(200).send("Hello World!")
});

router.get('/users', (req, res) => {
    res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Users API Test</title>
</head>
<body>
  <h1>Users API Test</h1>

  <section>
    <h2>Register</h2>
    <label>Username: <input id="username" /></label><br>
    <label>Password: <input id="password" type="password" /></label><br>
    <label>Role: <input id="role" /></label><br>
    <button id="registerBtn">Register</button>
    <pre id="registerResult"></pre>
  </section>

  <section>
    <h2>Login</h2>
    <label>Username: <input id="login_username" /></label><br>
    <label>Password: <input id="login_password" type="password" /></label><br>
    <button id="loginBtn">Login</button>
    <pre id="loginResult"></pre>
  </section>

  <section>
    <h2>All Users</h2>
    <button id="fetchAllBtn">Fetch All</button>
    <pre id="allResult"></pre>
  </section>

  <script>
    const byId = (id) => document.getElementById(id);

    byId('registerBtn').addEventListener('click', async () => {
      const user = byId('username').value;
      const password = byId('password').value;
      const role = byId('role').value;
      try {
        const resp = await fetch('/api/users/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, password, role })
        });
        const data = await resp.json().catch(() => null);
        byId('registerResult').textContent = JSON.stringify(data ?? { status: resp.status, statusText: resp.statusText }, null, 2);
      } catch (e) {
        byId('registerResult').textContent = String(e);
      }
    });

    byId('loginBtn').addEventListener('click', async () => {
      const user = byId('login_username').value;
      const password = byId('login_password').value;
      try {
        const resp = await fetch('/api/users/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, password })
        });
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          byId('loginResult').textContent = JSON.stringify(data, null, 2);
        } catch (_) {
          byId('loginResult').textContent = text;
        }
      } catch (e) {
        byId('loginResult').textContent = String(e);
      }
    });

    byId('fetchAllBtn').addEventListener('click', async () => {
      try {
        const resp = await fetch('/api/users/all');
        const data = await resp.json().catch(() => null);
        byId('allResult').textContent = JSON.stringify(data ?? { status: resp.status, statusText: resp.statusText }, null, 2);
      } catch (e) {
        byId('allResult').textContent = String(e);
      }
    });
  </script>
</body>
</html>`);
});

export default router;