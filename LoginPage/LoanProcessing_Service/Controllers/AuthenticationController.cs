using AuthenticationService.Models;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;

namespace Authentication.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthenticationController : ControllerBase
{
    private static readonly string _userFilePath = "users.json";
    private static readonly JsonSerializerOptions _jsonOptions =
        new JsonSerializerOptions { WriteIndented = true };
    /// <summary>
    /// Login payload: Username + Password only.
    /// </summary>
    public class LoginRequest
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
    }
    /// <summary>
    /// Register a new user with Username, Email, and Password.
    /// Password is stored as a BCrypt hash.
    /// </summary>
    [HttpPost("register")]
    public IActionResult Register([FromBody] User newUser)
    {
        if (newUser is null)
            return BadRequest(new { message = "Request body cannot be empty." });
        var username = newUser.Username?.Trim();
        var email = newUser.Email?.Trim();
        var password = newUser.Password?.Trim();
        if (string.IsNullOrWhiteSpace(username) ||
            string.IsNullOrWhiteSpace(email) ||
            string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { message = "Username, Email and Password are required." });
        }
        var users = LoadUsers();
        // Case-insensitive uniqueness
        if (users.Any(u => string.Equals(u.Username, username, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new { message = "Username already exists" });
        }
        if (users.Any(u => string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new { message = "Email already registered" });
        }
        // Hash & persist
        var userToPersist = new User
        {
            Username = username,
            Email = email,
            Password = BCrypt.Net.BCrypt.HashPassword(password)
        };
        users.Add(userToPersist);
        var json = JsonSerializer.Serialize(users, _jsonOptions);
        System.IO.File.WriteAllText(_userFilePath, json);
        return Ok(new { message = "User registered successfully" });
    }
    /// <summary>
    /// Login with Username and Password.
    /// </summary>
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest login)
    {
        if (login is null)
            return BadRequest(new { message = "Request body cannot be empty." });
        var username = login.Username?.Trim();
        var password = login.Password?.Trim();
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { message = "Username and Password are required." });
        }
        var users = LoadUsers();
        // Find by Username (case-insensitive)
        var user = users.FirstOrDefault(u =>
            !string.IsNullOrWhiteSpace(u.Username) &&
            string.Equals(u.Username.Trim(), username, StringComparison.OrdinalIgnoreCase));
        if (user == null || !BCrypt.Net.BCrypt.Verify(password, user.Password))
        {
            return Unauthorized(new { message = "Invalid credentials" });
        }
        return Ok(new { username = user.Username, email = user.Email });
    }
    private static List<User> LoadUsers()
    {
        if (!System.IO.File.Exists(_userFilePath))
            return new List<User>();
        var json = System.IO.File.ReadAllText(_userFilePath);
        return JsonSerializer.Deserialize<List<User>>(json) ?? new List<User>();
    }
}

