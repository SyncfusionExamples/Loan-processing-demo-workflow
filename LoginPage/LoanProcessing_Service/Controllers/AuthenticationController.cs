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

    // GET api/authentication/GetPdfStream
    [HttpGet("GetPdfStream/{filename}")]
    public IActionResult GetPdfStream(string filename)
    {
        if (string.IsNullOrWhiteSpace(filename))
            return BadRequest(new { message = "Filename is required" });
        try
        {
            var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "Data");
            var filePath = Path.Combine(dataDir, filename);

            if (!System.IO.File.Exists(filePath))
                return NotFound(new { message = "PDF file not found." });

            var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read);
            return new FileStreamResult(stream, "application/pdf");
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Error retrieving PDF stream: {ex.Message}");
        }
    }

    // POST api/authentication/SaveFilledForms
    [HttpPost("SaveFilledForms")]
    public IActionResult SaveFilled([FromBody] SaveFilledRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Base64))
            return BadRequest("Invalid data");

        // Extract pure Base64 (strip data URL prefix if present)
        var data = req.Base64.Contains(",") ? req.Base64.Split(',')[1] : req.Base64;
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(data);
        }
        catch
        {
            return BadRequest("Invalid base64 data");
        }

        // Save into project Data folder
        var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "Data");
        Directory.CreateDirectory(dataDir);

        var desired = string.IsNullOrWhiteSpace(req.FileName) ? "loan_form_1.pdf" : req.FileName.Trim();
        if (!desired.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) desired += ".pdf";
        var safeName = Path.GetFileName(desired); // prevents path traversal

        var fullPath = Path.Combine(dataDir, safeName);
        System.IO.File.WriteAllBytes(fullPath, bytes);

        // Logical public URL (Data folder may not be served by StaticFiles)
        var publicUrl = $"/Data/{Uri.EscapeDataString(safeName)}";

        return Ok(new { saved = true, path = fullPath, url = publicUrl });
    }

    public class SaveFilledRequest
    {
        public string? Base64 { get; set; }
        public string? FileName { get; set; }
    }
}

