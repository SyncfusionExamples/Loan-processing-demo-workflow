import { useState } from "react";
import "./index.css"; // Make sure this CSS file exists and is correctly styled

const hostURL = "https://localhost:44310/api/Authentication";

function Authentication({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState("");

  const validateEmail = (email) => /\S+@\S+\.\S+/.test(email);

  const handleLogin = async (event) => {
    event.preventDefault();
    setMessage("");

    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value.trim();

    if (!validateEmail(email)) {
      setMessage("❌ Please enter a valid email.");
      return;
    }

    try {
      const response = await fetch(`${hostURL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const userData = await response.json();
        localStorage.setItem("user", JSON.stringify(userData));
        onLogin(userData);
      } else {
        setMessage("❌ Invalid email or password.");
      }
    } catch {
      setMessage("⚠️ Server error during login.");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setMessage("");

    const form = e.currentTarget;
    const email = form.elements.email.value;
    const password = form.elements.password.value;

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

      const data = await register.json();
      if (register.ok) {
        setMessage("✅ Registration successful. You can now log in.");
        setIsRegistering(false);
        setUsername("");
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
      <form className="auth-form" onSubmit={isRegistering ? handleRegister : handleLogin}>
        {isRegistering && (
          <>
            <label className="auth-label" htmlFor="username">Username:</label>
            <input
              id="username"
              type="text"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="auth-input"
              placeholder="Your username"
            />
          </>
        )}
        <label className="auth-label" htmlFor="email">Email:</label>
        <input
          id="email"
          type="email"
          name="email"
          required
          className="auth-input"
          placeholder="you@example.com"
        />
        <label className="auth-label" htmlFor="password">Password:</label>
        <input
          id="password"
          type="password"
          name="password"
          required
          className="auth-input"
          placeholder="Your password"
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
          setUsername("");
        }}
        style={{ marginTop: 12 }}
      >
        {isRegistering ? "Already have an account? Log in" : "Don't have an account? Register"}
      </button>
      {message && <p className="auth-message">{message}</p>}
    </div>
  );
}

export default Authentication;
