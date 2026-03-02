
import { useState } from "react";
import "./index.css"; // Ensure this exists and has your styles
import "./Authentication.css";

const hostURL = "http://localhost:5063/api/Authentication";

function Authentication({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState("");

  const validateEmail = (email) => /\S+@\S+\.\S+/.test(email);

  const handleLogin = async (event) => {
    event.preventDefault();
    setMessage("");

    const form = event.currentTarget;
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value.trim();

    if (!username || !password) {
      setMessage("❌ Username and password are required.");
      return;
    }

    try {
      const response = await fetch(`${hostURL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const userData = await response.json();
        localStorage.setItem("user", JSON.stringify(userData));
        onLogin?.(userData);
      } else {
        const err = await response.json().catch(() => ({}));
        setMessage(`❌ ${err.message || "Invalid username or password."}`);
      }
    } catch {
      setMessage("⚠️ Server error during login.");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setMessage("");

    const form = e.currentTarget;
    const username = form.elements.username.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value.trim();

    if (!username) {
      setMessage("❌ Please enter a username.");
      return;
    }
    if (!validateEmail(email)) {
      setMessage("❌ Please enter a valid email.");
      return;
    }

    try {
      const register = await fetch(`${hostURL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await register.json().catch(() => ({}));
      if (register.ok) {
        setMessage("✅ Registration successful. You can now log in.");
        setIsRegistering(false);
        setUsername("");
        form.reset();
      } else {
        setMessage(`❌ ${data.message || "Registration failed"}`);
      }
    } catch {
      setMessage("⚠️ Server error during registration.");
    }
  };

  return (
    <div className="auth-container">
      <h2 className="auth-title">{isRegistering ? "Register" : "Login"}</h2>

      <form
        className="auth-form"
        onSubmit={isRegistering ? handleRegister : handleLogin}
      >
        {/* Username is needed for both Login and Register */}
        <label className="auth-label" htmlFor="username">User Name:</label>
        <input
          id="username"
          type="text"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="auth-input"
          placeholder="Your username"
          autoComplete="username"
        />

        {/* Email appears only during registration */}
        {isRegistering && (
          <>
            <label className="auth-label" htmlFor="email">Email:</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              className="auth-input"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </>
        )}

        <label className="auth-label" htmlFor="password">Password:</label>
        <input
          id="password"
          type="password"
          name="password"
          required
          className="auth-input"
          placeholder="Your password"
          autoComplete={isRegistering ? "new-password" : "current-password"}
        />

        <button type="submit" className="auth-button primary">
          {isRegistering ? "Register" : "Login"}
        </button>
      </form>

      <button
        className="auth-button secondary"
        onClick={() => {
          setIsRegistering(!isRegistering);
          setMessage("");
        }}
        style={{ marginTop: 12 }}
      >
        {isRegistering
          ? "Already have an account? Log in"
          : "Don't have an account? Register"}
      </button>

      {message && <p className="auth-message">{message}</p>}
    </div>
  );
}

export default Authentication;
