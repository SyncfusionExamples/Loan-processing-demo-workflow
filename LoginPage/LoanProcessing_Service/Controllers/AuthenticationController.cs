using AuthenticationService.Models;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;

namespace Authentication.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthenticationController : ControllerBase
{
    private static readonly string _userFilePath = "users.json";

    // Register the new user with the credentials like Username, Email ID and Password
    [HttpPost("register")]
    public IActionResult Register([FromBody] User newUser)
    {
        var Users = LoadUsers();
        if (Users.Any(u => u.Username == newUser.Username))
        {
            return BadRequest(new { message = "Username already exists" });
        }
        if (Users.Any(u => u.Email == newUser.Email))
        {
            return BadRequest(new { message = "Email already registered" });
        }
        newUser.Password = BCrypt.Net.BCrypt.HashPassword(newUser.Password);
        Users.Add(newUser);
        var json = JsonSerializer.Serialize(Users, new JsonSerializerOptions { WriteIndented = true });
        System.IO.File.WriteAllText(_userFilePath, json);
        return Ok(new { message = "User registered successfully" });
    }

    // Existing user can login using the credentials such as Email ID and password
    [HttpPost("login")]
    public IActionResult Login([FromBody] User login)
    {
        var Users = LoadUsers();
        var user = Users.FirstOrDefault(u => u.Email == login.Email);
        if (user == null || !BCrypt.Net.BCrypt.Verify(login.Password, user.Password))
        {
            return Unauthorized(new { message = "Invalid credentials" });
        }

        return Ok(new { username = user.Username, email = user.Email });
    }

    // 🔸 Load the user details from the local storage file
    private static List<User> LoadUsers()
    {
        if (!System.IO.File.Exists(_userFilePath))
            return new List<User>();

        var json = System.IO.File.ReadAllText(_userFilePath);
        return JsonSerializer.Deserialize<List<User>>(json) ?? new List<User>();
    }
}