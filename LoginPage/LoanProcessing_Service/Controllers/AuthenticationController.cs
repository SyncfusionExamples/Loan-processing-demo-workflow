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
        var fileName = desired;
        if (!desired.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) desired += ".pdf";
        var safeName = Path.GetFileName(desired); // prevents path traversal

        var fullPath = Path.Combine(dataDir, safeName);
        System.IO.File.WriteAllBytes(fullPath, bytes);

        // Build index entry keys
        var username = (req.Username ?? "").Trim();
        var documentId = (req.DocumentId ?? "").Trim();
        if (string.IsNullOrWhiteSpace(documentId))
        {
            // generate a simple numeric-ish id if you need deterministic ids, else GUID
            documentId = DateTime.UtcNow.Ticks.ToString();
        }
        var fileNameKey = fileName; // what we actually wrote
        var status = string.IsNullOrWhiteSpace(req.Status) ? "SUBMITTED" : req.Status.Trim();

        // Read-modify-write userFiles.json safely and idempotently
        try
        {
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            List<UserFileEntry> list;
            if (System.IO.File.Exists(indexPath))
            {
                var json = System.IO.File.ReadAllText(indexPath);
                list = string.IsNullOrWhiteSpace(json)
                    ? new List<UserFileEntry>()
                    : JsonSerializer.Deserialize<List<UserFileEntry>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                      ?? new List<UserFileEntry>();
            }
            else
            {
                list = new List<UserFileEntry>();
            }

            // Find existing entry by FileName only (ignore username/documentId).
            // Special-case: if the incoming filename contains a sanction marker
            // (e.g. "Customer1_1001_Sanction_Letter"), split to the base
            // filename ("Customer1_1001") and search by that. When updating
            // an existing entry we must NOT overwrite CustomerName — only
            // update FileName, Status and UpdatedAt.
            UserFileEntry? existing = null;
            if (!string.IsNullOrWhiteSpace(fileNameKey))
            {
                // derive search key (base filename)
                var searchKey = fileNameKey;
                existing = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.FileName) &&
                    string.Equals(x.FileName.Trim(), searchKey, StringComparison.OrdinalIgnoreCase));


                if (fileNameKey.IndexOf("Sanction", StringComparison.OrdinalIgnoreCase) >= 0 && status == "SIGN_REQUIRED" && existing == null)
                {
                    if (fileNameKey.IndexOf("Sanction", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        var idx = fileNameKey.IndexOf("_Sanction", StringComparison.OrdinalIgnoreCase);
                        if (idx >= 0)
                        {
                            searchKey = fileNameKey.Substring(0, idx);
                        }
                        else
                        {
                            // fallback: find "Sanction" and trim at previous underscore
                            idx = fileNameKey.IndexOf("Sanction", StringComparison.OrdinalIgnoreCase);
                            if (idx > 0)
                            {
                                var lastUnd = fileNameKey.LastIndexOf('_', idx - 1);
                                if (lastUnd >= 0)
                                    searchKey = fileNameKey.Substring(0, lastUnd);
                                else
                                    searchKey = fileNameKey.Substring(0, idx);
                            }
                        }
                    }
                }
                existing = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.FileName) &&
                    string.Equals(x.FileName.Trim(), searchKey, StringComparison.OrdinalIgnoreCase));
            }

            if (existing != null)
            {
                existing.FileName = fileNameKey; // update to the new name (may include _Sanction...)
                existing.Status = status;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                list.Add(new UserFileEntry
                {
                    CustomerName = req.CustomerName,
                    DocumentId = documentId,
                    FileName = fileNameKey,
                    Username = username,
                    Status = status,
                    CreatedAt = DateTime.UtcNow
                });
            }

            // atomic write
            var tmp = indexPath + ".tmp";
            var outJson = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(tmp, outJson);
            System.IO.File.Copy(tmp, indexPath, overwrite: true);
            System.IO.File.Delete(tmp);
        }
        catch
        {
            // index write failure should not break file save - log as appropriate
        }

        // Logical public URL (Data folder may not be served by StaticFiles)
        var publicUrl = $"/Data/{Uri.EscapeDataString(safeName)}";

        return Ok(new { saved = true, path = fullPath, url = publicUrl });
    }
    [HttpPost("UpdateFileStatus")]
    public IActionResult UpdateFileStatus([FromBody] UpdateStatusRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Status))
            return BadRequest("Invalid data");

        try
        {
            var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "Data");
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            if (!System.IO.File.Exists(indexPath))
                return NotFound("Index not found");

            var json = System.IO.File.ReadAllText(indexPath);
            var list = string.IsNullOrWhiteSpace(json)
                ? new List<UserFileEntry>()
                : JsonSerializer.Deserialize<List<UserFileEntry>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                  ?? new List<UserFileEntry>();

            var incomingDoc = (req.DocumentId ?? "").Trim();
            var incomingFile = (req.FileName ?? "").Trim();

            UserFileEntry? entry = null;

            // 2) exact FileName match
            if (!string.IsNullOrWhiteSpace(incomingFile))
            {
                entry = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.FileName) &&
                    string.Equals(x.FileName.Trim(), incomingFile, StringComparison.OrdinalIgnoreCase));
            }

            // do not create a new entry here — return NotFound so client can handle
            if (entry == null)
                return NotFound("Entry not found");

            // update status and timestamp
            entry.Status = req.Status.Trim();
            entry.UpdatedAt = DateTime.UtcNow;

            // atomic write back
            var tmp = indexPath + ".tmp";
            var outJson = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(tmp, outJson);
            System.IO.File.Copy(tmp, indexPath, overwrite: true);
            System.IO.File.Delete(tmp);

            return Ok(new { updated = true });
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Error updating status: {ex.Message}");
        }
    }
    [HttpGet("GetUserFiles")]
    public IActionResult GetUserFiles([FromQuery] string username)
    {
        if (string.IsNullOrWhiteSpace(username))
            return BadRequest("username required");

        try
        {
            var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "Data");
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            if (!System.IO.File.Exists(indexPath))
                return Ok(new List<UserFileEntry>());

            var json = System.IO.File.ReadAllText(indexPath);
            var list = string.IsNullOrWhiteSpace(json)
                ? new List<UserFileEntry>()
                : JsonSerializer.Deserialize<List<UserFileEntry>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                  ?? new List<UserFileEntry>();
            if (string.Equals(username, "ALL", StringComparison.OrdinalIgnoreCase))
            {
                return Ok(list.OrderByDescending(x => x.CreatedAt).ToList());
            }
            var matched = list
                .Where(x => string.Equals(x.Username ?? x.CustomerName ?? "", username, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.CreatedAt)
                .ToList();

            return Ok(matched);
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Error reading user files: {ex.Message}");
        }
    }

    public class SaveFilledRequest
    {
        public string? Base64 { get; set; }
        public string? FileName { get; set; }
        public string? DocumentId { get; set; }
        public string? Username { get; set; }
        public string? CustomerName { get; set; }
        public string? Status { get; set; }
    }
    public class UpdateStatusRequest
    {
        public string DocumentId { get; set; }   // preferred
        public string FileName { get; set; }     // optional fallback
        public string Status { get; set; }       // required: "APPROVED" / "REJECTED" / etc.
    }
    public class UserFileEntry
    {
        public string CustomerName { get; set; }
        public string DocumentId { get; set; }
        public string FileName { get; set; }
        public string Username { get; set; }
        public string Status { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }
}

