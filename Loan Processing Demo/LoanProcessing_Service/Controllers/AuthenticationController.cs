using AuthenticationService.Models;
using Microsoft.AspNetCore.Mvc;
using Syncfusion.Pdf;
using Syncfusion.Pdf.Interactive;
using Syncfusion.Pdf.Parsing;
using System.Reflection;
using System.Text.Json;

namespace Authentication.Controllers;

/// <summary>
/// Controller that exposes PDF/file and simple user management endpoints used by the client.
/// Non-functional optimizations were applied (centralized paths, shared Json options, proper disposal).
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class AuthenticationController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<AuthenticationController> _logger;

    // Use environment content root so paths are explicit and consistent
    private readonly string _userFilePath;

    // Reusable JSON options
    private static readonly JsonSerializerOptions _jsonOptions =
        new JsonSerializerOptions { WriteIndented = true };

    private static readonly JsonSerializerOptions _jsonOptionsCaseInsensitive =
        new JsonSerializerOptions { PropertyNameCaseInsensitive = true, WriteIndented = true };

    /// <summary>
    /// Creates a new instance of <see cref="AuthenticationController"/>.
    /// </summary>
    public AuthenticationController(IWebHostEnvironment env, ILogger<AuthenticationController> logger)
    {
        _env = env ?? throw new ArgumentNullException(nameof(env));
        _logger = logger;
        _userFilePath = Path.Combine(_env.ContentRootPath ?? Directory.GetCurrentDirectory(), "users.json");
    }

    /// <summary>
    /// Helper property to resolve the app Data directory path.
    /// </summary>
    private string DataDirectory => Path.Combine(_env.ContentRootPath ?? Directory.GetCurrentDirectory(), "Data");

    /// <summary>
    /// Login payload: Username + Password only.
    /// </summary>
    public class LoginRequest
    {
        /// <summary>Username attempting to authenticate.</summary>
        public string? Username { get; set; }
        /// <summary>Password (plain text supplied by client over HTTPS in typical setups).</summary>
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
    /// Returns basic user info on success.
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

    /// <summary>
    /// Loads users from the local <c>users.json</c> file.
    /// Returns an empty list on IO/parse error to avoid throwing from endpoint handlers.
    /// </summary>
    private List<User> LoadUsers()
    {
        try
        {
            if (!System.IO.File.Exists(_userFilePath))
                return new List<User>();
            var json = System.IO.File.ReadAllText(_userFilePath);
            return JsonSerializer.Deserialize<List<User>>(json) ?? new List<User>();
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "LoadUsers failed, returning empty user list");
            return new List<User>();
        }
    }

    /// <summary>
    /// Returns a PDF stream for the specified <paramref name="filename"/>.
    /// </summary>
    /// <param name="filename">PDF filename located under the Data folder.</param>
    [HttpGet("GetPdfStream/{filename}")]
    public IActionResult GetPdfStream(string filename)
    {
        if (string.IsNullOrWhiteSpace(filename))
            return BadRequest(new { message = "Filename is required" });
        try
        {
            var dataDir = DataDirectory;
            var filePath = Path.Combine(dataDir, filename);

            if (!System.IO.File.Exists(filePath))
                return NotFound(new { message = "PDF file not found." });

            var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            return new FileStreamResult(stream, "application/pdf");
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Error retrieving PDF stream: {ex.Message}");
        }
    }

    /// <summary>
    /// Saves a filled PDF form (base64) and any provided attachments.
    /// Attempts to embed attachments into the PDF; falls back to saving attachments externally.
    /// Returns file metadata and any attachment info.
    /// </summary>
    [HttpPost("SaveFilledForms")]
    public IActionResult SaveFilled([FromBody] SaveFilledRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Base64))
            return BadRequest("Invalid data");

        // Extract pure Base64 (strip data URL prefix if present)
        var data = req.Base64.Contains(",") ? req.Base64.Split(',')[1] : req.Base64;
        byte[] bytes;
        try { bytes = Convert.FromBase64String(data); } catch { return BadRequest("Invalid base64 data"); }

        var dataDir = DataDirectory;
        Directory.CreateDirectory(dataDir);

        // Normalize filename to always include .pdf and make safe
        var desired = string.IsNullOrWhiteSpace(req.FileName) ? "loan_form_1.pdf" : req.FileName.Trim();
        if (!desired.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) desired += ".pdf";
        var safeName = Path.GetFileName(desired);
        var fullPath = Path.Combine(dataDir, safeName);

        var attachmentsSavedInfo = new List<object>();
        var attachmentsFolder = Path.Combine(dataDir, Path.GetFileNameWithoutExtension(safeName) + "_attachments");
        Directory.CreateDirectory(attachmentsFolder);

        // Try to embed attachments into PDF; fallback to saving externally.
        if (req.Attachments != null && req.Attachments.Count > 0)
        {
            try
            {
                using (var mainStream = new MemoryStream(bytes))
                using (var loadedDocument = new PdfLoadedDocument(mainStream))
                {
                    foreach (var att in req.Attachments)
                    {
                        if (att == null || string.IsNullOrWhiteSpace(att.Base64)) continue;
                        var attData = att.Base64.Contains(",") ? att.Base64.Split(',')[1] : att.Base64;
                        byte[] attBytes;
                        try { attBytes = Convert.FromBase64String(attData); } catch { continue; }

                        var attachFileName = !string.IsNullOrWhiteSpace(att.Name) ? att.Name :
                                             !string.IsNullOrWhiteSpace(att.OriginalName) ? att.OriginalName :
                                             $"attachment_{Guid.NewGuid()}";

                        var embedded = false;
                        try
                        {
                            var pdfAttachment = new PdfAttachment(attachFileName, attBytes);
                            if (loadedDocument.Attachments == null) loadedDocument.CreateAttachment();
                            loadedDocument.Attachments.Add(pdfAttachment);
                            embedded = true;
                            attachmentsSavedInfo.Add(new { fileName = attachFileName, embedded = true });
                        }
                        catch (Exception embedEx)
                        {
                            _logger?.LogWarning(embedEx, "Embedding failed; saving attachment externally.");
                            embedded = false;
                        }

                        if (!embedded)
                        {
                            var savedPath = Path.Combine(attachmentsFolder, Path.GetFileName(attachFileName));
                            System.IO.File.WriteAllBytes(savedPath, attBytes);
                            var publicUrl1 = $"/api/Authentication/GetExternalAttachment/{Uri.EscapeDataString(Path.GetFileNameWithoutExtension(safeName))}/{Uri.EscapeDataString(Path.GetFileName(attachFileName))}";
                            attachmentsSavedInfo.Add(new { fileName = attachFileName, embedded = false, url = publicUrl1, path = savedPath });
                        }
                    }

                    using (var outMs = new MemoryStream())
                    {
                        loadedDocument.Save(outMs);
                        System.IO.File.WriteAllBytes(fullPath, outMs.ToArray());
                    }
                }
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Attachment embedding failed; saving original PDF and externals.");
                System.IO.File.WriteAllBytes(fullPath, bytes);

                if (req.Attachments != null && req.Attachments.Count > 0)
                {
                    foreach (var att in req.Attachments)
                    {
                        if (att == null || string.IsNullOrWhiteSpace(att.Base64)) continue;
                        var attData = att.Base64.Contains(",") ? att.Base64.Split(',')[1] : att.Base64;
                        byte[] attBytes;
                        try { attBytes = Convert.FromBase64String(attData); } catch { continue; }

                        var attachFileName = !string.IsNullOrWhiteSpace(att.Name) ? att.Name :
                                             !string.IsNullOrWhiteSpace(att.OriginalName) ? att.OriginalName :
                                             $"attachment_{Guid.NewGuid()}";

                        var savedPath = Path.Combine(attachmentsFolder, Path.GetFileName(attachFileName));
                        try
                        {
                            System.IO.File.WriteAllBytes(savedPath, attBytes);
                            var publicUrl1 = $"/api/Authentication/GetExternalAttachment/{Uri.EscapeDataString(Path.GetFileNameWithoutExtension(safeName))}/{Uri.EscapeDataString(Path.GetFileName(attachFileName))}";
                            attachmentsSavedInfo.Add(new { fileName = attachFileName, embedded = false, url = publicUrl1, path = savedPath });
                        }
                        catch { /* swallow */ }
                    }
                }
            }
        }
        else
        {
            System.IO.File.WriteAllBytes(fullPath, bytes);
        }

        // Build keys and normalize status to server canonical (e.g., "INFO REQUIRED" -> "INFO_REQUIRED")
        var username = (req.Username ?? "").Trim();
        var documentId = (req.DocumentId ?? "").Trim();
        if (string.IsNullOrWhiteSpace(documentId)) documentId = DateTime.UtcNow.Ticks.ToString();

        // Normalize incoming status (collapse whitespace -> underscores, uppercase)
        var statusRaw = string.IsNullOrWhiteSpace(req.Status) ? "SUBMITTED" : req.Status.Trim();
        var status = NormalizeStatus(statusRaw); // implement helper if not present

        var fileNameKey = safeName; // normalized name stored

        try
        {
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            List<UserFileEntry> list;
            if (System.IO.File.Exists(indexPath))
            {
                var json = System.IO.File.ReadAllText(indexPath);
                list = string.IsNullOrWhiteSpace(json)
                    ? new List<UserFileEntry>()
                    : JsonSerializer.Deserialize<List<UserFileEntry>>(json, _jsonOptionsCaseInsensitive) ?? new List<UserFileEntry>();
            }
            else list = new List<UserFileEntry>();

            // Match existing entry: 1) DocumentId, 2) tolerant filename variants, 3) docKey fallback
            UserFileEntry? existing = null;

            if (!string.IsNullOrWhiteSpace(documentId))
            {
                existing = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.DocumentId) &&
                    string.Equals(x.DocumentId.Trim(), documentId, StringComparison.OrdinalIgnoreCase));
            }

            if (existing == null && !string.IsNullOrWhiteSpace(fileNameKey))
            {
                var candidates = new List<string> { fileNameKey };
                if (!fileNameKey.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) candidates.Add(fileNameKey + ".pdf");
                else candidates.Add(Path.GetFileNameWithoutExtension(fileNameKey));
                try
                {
                    candidates.Add(Path.GetFileName(fileNameKey));
                    if (!fileNameKey.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                        candidates.Add(Path.GetFileName(fileNameKey) + ".pdf");
                }
                catch { }

                var uniq = candidates
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Select(s => s.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                existing = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.FileName) &&
                    uniq.Any(fc => string.Equals(x.FileName.Trim(), fc, StringComparison.OrdinalIgnoreCase)));
            }

            if (existing == null && !string.IsNullOrWhiteSpace(fileNameKey))
            {
                var temp = new UserFileEntry { FileName = fileNameKey };
                var key = GetDocKey(temp);
                if (!string.IsNullOrWhiteSpace(key))
                {
                    existing = list.FirstOrDefault(x => string.Equals(GetDocKey(x), key, StringComparison.OrdinalIgnoreCase));
                }
            }

            if (existing != null)
            {
                existing.FileName = fileNameKey;

                // Preserve prior promotion: only applicant submitting SIGN_REQUIRED -> PENDING_APPROVAL
                var unameLower = (username ?? "").ToString().ToLowerInvariant();
                bool isManager = !string.IsNullOrWhiteSpace(unameLower) && unameLower.Contains("manager");
                bool isLoanOfficer = !string.IsNullOrWhiteSpace(unameLower) && unameLower.Contains("loan") && unameLower.Contains("officer");
                bool isApplicant = !(isManager || isLoanOfficer);

                if (isApplicant && string.Equals(status, "SIGN_REQUIRED", StringComparison.OrdinalIgnoreCase))
                {
                    status = "PENDING_APPROVAL";
                }

                existing.Status = status;
                existing.UpdatedAt = DateTime.UtcNow;

                if (string.IsNullOrWhiteSpace(existing.DocumentId) && !string.IsNullOrWhiteSpace(documentId))
                {
                    existing.DocumentId = documentId;
                }
            }
            else
            {
                // Create only if no match found
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
            var outJson = JsonSerializer.Serialize(list, _jsonOptions);
            System.IO.File.WriteAllText(tmp, outJson);
            System.IO.File.Copy(tmp, indexPath, overwrite: true);
            System.IO.File.Delete(tmp);
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "Failed to update userFiles.json while saving filled form.");
        }

        var publicUrl = $"/Data/{Uri.EscapeDataString(safeName)}";
        return Ok(new { saved = true, path = fullPath, url = publicUrl, attachments = attachmentsSavedInfo, fileName = safeName });
    }
    /// <summary>
    /// Update the status of an existing file entry in the index.
    /// </summary>
    [HttpPost("UpdateFileStatus")]
    public IActionResult UpdateFileStatus([FromBody] UpdateStatusRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Status))
            return BadRequest("Invalid data");

        try
        {
            var dataDir = DataDirectory;
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            if (!System.IO.File.Exists(indexPath))
                return NotFound("Index not found");

            var json = System.IO.File.ReadAllText(indexPath);
            var list = string.IsNullOrWhiteSpace(json)
                ? new List<UserFileEntry>()
                : JsonSerializer.Deserialize<List<UserFileEntry>>(json, _jsonOptionsCaseInsensitive)
                  ?? new List<UserFileEntry>();

            var incomingDoc = (req.DocumentId ?? "").Trim();
            var incomingFile = (req.FileName ?? "").Trim();

            // Normalize incoming status
            var normalizedStatus = NormalizeStatus(req.Status);

            UserFileEntry? entry = null;

            if (!string.IsNullOrWhiteSpace(incomingDoc))
            {
                entry = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.DocumentId) &&
                    string.Equals(x.DocumentId.Trim(), incomingDoc, StringComparison.OrdinalIgnoreCase));
            }

            if (entry == null && !string.IsNullOrWhiteSpace(incomingFile))
            {
                var candidates = new List<string> { incomingFile };
                if (!incomingFile.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                    candidates.Add(incomingFile + ".pdf");
                else
                    candidates.Add(Path.GetFileNameWithoutExtension(incomingFile));

                try
                {
                    candidates.Add(Path.GetFileName(incomingFile));
                    if (!incomingFile.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                        candidates.Add(Path.GetFileName(incomingFile) + ".pdf");
                }
                catch { }

                var uniq = candidates
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Select(s => s.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                entry = list.FirstOrDefault(x =>
                    !string.IsNullOrWhiteSpace(x.FileName) &&
                    uniq.Any(fc => string.Equals(x.FileName.Trim(), fc, StringComparison.OrdinalIgnoreCase)));
            }

            if (entry == null && !string.IsNullOrWhiteSpace(incomingFile))
            {
                var temp = new UserFileEntry { FileName = incomingFile };
                var key = GetDocKey(temp);
                if (!string.IsNullOrWhiteSpace(key))
                {
                    entry = list.FirstOrDefault(x => string.Equals(GetDocKey(x), key, StringComparison.OrdinalIgnoreCase));
                }
            }

            if (entry == null)
                return NotFound("Entry not found");

            entry.Status = normalizedStatus;
            entry.UpdatedAt = DateTime.UtcNow;

            var tmp = indexPath + ".tmp";
            var outJson = JsonSerializer.Serialize(list, _jsonOptions);
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
    private static string NormalizeStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return string.Empty;
        // Collapse whitespace into single underscores and uppercase to match server canonical keys
        var s = System.Text.RegularExpressions.Regex.Replace(status.Trim(), @"\s+", "_");
        return s.ToUpperInvariant();
    }
    /// <summary>
    /// Returns list of files for a given user (or ALL).
    /// </summary>

    [HttpGet("GetUserFiles")]
    public IActionResult GetUserFiles([FromQuery] string username)
    {
        if (string.IsNullOrWhiteSpace(username))
            return BadRequest("username required");

        try
        {
            var dataDir = DataDirectory;
            var indexPath = Path.Combine(dataDir, "userFiles.json");
            if (!System.IO.File.Exists(indexPath))
                return Ok(new List<UserFileEntry>());

            var json = System.IO.File.ReadAllText(indexPath);
            var list = string.IsNullOrWhiteSpace(json)
                ? new List<UserFileEntry>()
                : JsonSerializer.Deserialize<List<UserFileEntry>>(json, _jsonOptionsCaseInsensitive)
                  ?? new List<UserFileEntry>();

            IEnumerable<UserFileEntry> source = list;

            if (!string.Equals(username, "ALL", StringComparison.OrdinalIgnoreCase))
            {
                var userDocIds = new HashSet<string>(
                    list
                        .Where(x =>
                            string.Equals(
                                x?.Username ?? x?.CustomerName ?? string.Empty,
                                username,
                                StringComparison.OrdinalIgnoreCase))
                        .Select(x => GetDocKey(x)),
                    StringComparer.OrdinalIgnoreCase
                );

                source = list.Where(x => userDocIds.Contains(GetDocKey(x)));
            }

            var perDocumentLatest = source
                .GroupBy(x => GetDocKey(x))
                .Select(g => g
                    .OrderByDescending(x =>
                        StatusRank.TryGetValue(x?.Status ?? string.Empty, out var r) ? r : 0)
                    .ThenByDescending(x => x?.CreatedAt)
                    .ThenByDescending(x => x?.FileName)
                    .First())
                .OrderByDescending(x => x.UpdatedAt ?? x.CreatedAt)
                .ToList();

            // Convert stored canonical statuses to the display strings expected by the client
            foreach (var entry in perDocumentLatest)
            {
                entry.Status = FormatStatusForClient(entry.Status);
            }

            return Ok(perDocumentLatest);
        }
        catch (Exception ex)
        {
            return StatusCode(500, $"Error reading user files: {ex.Message}");
        }
    }
    private static string FormatStatusForClient(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return status ?? string.Empty;
        var s = status.Trim().ToUpperInvariant();

        // Map canonical server keys -> client display values (matches values in src/constants/loanStatus.js)
        return s switch
        {
            "UNDER_REVIEW" => "UNDER REVIEW",
            "INFO_REQUIRED" => "INFO REQUIRED",
            "PENDING_APPROVAL" => "PENDING APPROVAL",
            "NEW" => "NEW",
            "VALIDATING" => "VALIDATING",
            "SITE_VERIFIED" => "SITE_VERIFIED",
            "INFO_UPDATED" => "INFO_UPDATED",
            "APPROVED" => "APPROVED",
            "REJECTED" => "REJECTED",
            "SIGN_REQUIRED" => "SIGN_REQUIRED",
            // default: if server sent underscored string convert to space for display, otherwise return as-is
            _ => s.Contains('_') ? s.Replace('_', ' ') : s
        };
    }
    /// <summary>
    /// Returns metadata for attachments embedded in a PDF.
    /// </summary>
    [HttpGet("GetPdfAttachments/{fileName}")]
    public IActionResult GetPdfAttachments(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return BadRequest("fileName required");
        var dataDir = DataDirectory;
        var fullPath = Path.Combine(dataDir, fileName);
        if (!System.IO.File.Exists(fullPath)) return NotFound();

        try
        {
            using (var ms = new MemoryStream(System.IO.File.ReadAllBytes(fullPath)))
            using (var doc = new PdfLoadedDocument(ms))
            {
                var list = new List<object>();

                var attachments = doc.Attachments;
                if (attachments == null || attachments.Count == 0)
                    return Ok(list); // empty array

                for (int i = 0; i < attachments.Count; i++)
                {
                    var a = attachments[i];
                    string name = TryGetStringProperty(a, "FileName") ?? TryGetStringProperty(a, "Name") ?? $"attachment_{i}";
                    long? size = TryGetAttachmentSize(a);
                    list.Add(new { fileName = name, size = size, type = (string?)null, uploadedAt = (string?)null });
                }
                return Ok(list);
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "GetPdfAttachments failed for {file}", fileName);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Returns a specific attachment by name embedded within <paramref name="pdfFileName"/>.
    /// </summary>
    [HttpGet("GetPdfAttachmentFile/{pdfFileName}/{attachmentName}")]
    public IActionResult GetPdfAttachmentFile(string pdfFileName, string attachmentName)
    {
        if (string.IsNullOrWhiteSpace(pdfFileName)) return BadRequest("pdfFileName required");
        // decode client-encoded name (handles spaces etc.)
        attachmentName = string.IsNullOrWhiteSpace(attachmentName) ? attachmentName : Uri.UnescapeDataString(attachmentName).Trim();

        var dataDir = DataDirectory;
        var fullPath = Path.Combine(dataDir, pdfFileName);
        if (!System.IO.File.Exists(fullPath)) return NotFound();
        try
        {
            using (var ms = new MemoryStream(System.IO.File.ReadAllBytes(fullPath)))
            using (var doc = new PdfLoadedDocument(ms))
            {
                var attachments = doc.Attachments;
                if (attachments == null || attachments.Count == 0) return NotFound();

                _logger?.LogDebug("GetPdfAttachmentFile request: pdf={pdf} requestedAttachment={requested}", pdfFileName, attachmentName);

                for (int i = 0; i < attachments.Count; i++)
                {
                    var a = attachments[i];
                    string name = TryGetStringProperty(a, "FileName")
                                  ?? TryGetStringProperty(a, "Name")
                                  ?? TryGetStringProperty(a, "Filename")
                                  ?? a?.ToString()
                                  ?? $"attachment_{i}";

                    _logger?.LogDebug("Attachment candidate #{index}: name={name}", i, name);

                    if (string.Equals(Path.GetFileName(name), Path.GetFileName(attachmentName), StringComparison.OrdinalIgnoreCase))
                    {
                        var bytes = TryGetAttachmentBytes(a);
                        if (bytes != null)
                        {
                            var ext = Path.GetExtension(name) ?? string.Empty;
                            var contentType = ext.Equals(".pdf", StringComparison.OrdinalIgnoreCase) ? "application/pdf" : "application/octet-stream";
                            _logger?.LogDebug("Serving attachment {name} size={len}", name, bytes.Length);
                            return File(bytes, contentType, name);
                        }
                        _logger?.LogError("Attachment found but bytes extraction failed for {name}", name);
                        return StatusCode(500, new { error = "Attachment found but could not extract bytes" });
                    }
                }

                _logger?.LogDebug("No matching attachment found for request {requested} in {pdf}", attachmentName, pdfFileName);
                return NotFound();
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "GetPdfAttachmentFile failed for {pdf}/{att}", pdfFileName, attachmentName);
            return StatusCode(500, new { error = ex.Message });
        }
    }


    // Rank the workflow stages so the API always surfaces the latest/most-advanced state for each DocumentId.
    private static readonly Dictionary<string, int> StatusRank = new(StringComparer.OrdinalIgnoreCase)
    {

        ["REJECTED"] = 0,
        ["NEW"] = 1,
        ["UNDER_REVIEW"] = 2,
        ["INFO_REQUIRED"] = 3,
        ["INFO_UPDATED"] = 4,

        // 🔥 IMPORTANT CHANGE:
        // Manager → Sign Request MUST outrank PENDING_APPROVAL
        ["SIGN_REQUIRED"] = 6,

        ["PENDING_APPROVAL"] = 5,
        ["APPROVED"] = 7

    };

    // Build a stable grouping key for a row: prefer DocumentId; fallback to extracting digits from FileName.
    private static string GetDocKey(UserFileEntry x)
    {
        var id = x?.DocumentId?.ToString()?.Trim();
        if (!string.IsNullOrWhiteSpace(id)) return id!;

        var fn = (x?.FileName ?? x?.CustomerName ?? string.Empty).Trim();
        // Match either "..._1234.pdf" or "..._1234" or "...1234.pdf"
        var m = System.Text.RegularExpressions.Regex.Match(
            fn, @"(\d+)(?=\.pdf$)|_(\d+)$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase
        );

        if (m.Success)
            return !string.IsNullOrEmpty(m.Groups[1].Value) ? m.Groups[1].Value : m.Groups[2].Value;

        // Fallback: if no numeric id can be found, use filename as a last-resort key
        return fn;
    }
    // Helpers (reflection-friendly across versions)

    /// <summary>
    /// Attempts to read a string-like property (case-insensitive) from an object.
    /// Falls back to <c>ToString()</c> when no property is found.
    /// </summary>
    private static string? TryGetStringProperty(object obj, string propName)
    {
        try
        {
            if (obj == null) return null;
            var p = obj.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (p != null)
            {
                var v = p.GetValue(obj);
                return v?.ToString();
            }
            var s = obj.ToString();
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Attempts multiple strategies to extract raw bytes from a PDF attachment object.
    /// Works with byte[], Stream, nested properties or Save/ToArray style methods.
    /// </summary>
    private static byte[]? TryGetAttachmentBytes(object att)
    {
        try
        {
            if (att == null) return null;
            var t = att.GetType();

            if (att is byte[] b0) return b0;
            if (att is Stream s0) { using var ms0 = new MemoryStream(); s0.CopyTo(ms0); return ms0.ToArray(); }

            var candidateProps = new[] {
                "AttachedFile", "FileData", "File", "Data", "DataBytes",
                "FileContent", "EmbeddedFile", "Content", "Stream", "Bytes"
            };

            foreach (var propName in candidateProps)
            {
                var prop = t.GetProperty(propName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (prop == null) continue;
                var val = prop.GetValue(att);
                if (val == null) continue;

                if (val is byte[] b) return b;
                if (val is Stream s) { using var ms = new MemoryStream(); s.CopyTo(ms); return ms.ToArray(); }
                if (val is string str)
                {
                    try { return Convert.FromBase64String(str); } catch { }
                    if (System.IO.File.Exists(str)) return System.IO.File.ReadAllBytes(str);
                }

                var nestedStreamProp = val.GetType().GetProperty("Stream", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (nestedStreamProp != null)
                {
                    var sVal = nestedStreamProp.GetValue(val) as Stream;
                    if (sVal != null) { using var ms2 = new MemoryStream(); sVal.CopyTo(ms2); return ms2.ToArray(); }
                }

                var nestedBytesProp = val.GetType().GetProperty("Bytes", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (nestedBytesProp != null)
                {
                    var o = nestedBytesProp.GetValue(val);
                    if (o is byte[] nb) return nb;
                }
            }

            var saveMethod = t.GetMethod("Save", new[] { typeof(Stream) }) ??
                             t.GetMethod("SaveTo", new[] { typeof(Stream) }) ??
                             t.GetMethod("SaveAs", new[] { typeof(Stream) }) ??
                             t.GetMethod("WriteTo", new[] { typeof(Stream) });

            if (saveMethod != null)
            {
                using var ms = new MemoryStream();
                saveMethod.Invoke(att, new object[] { ms });
                return ms.ToArray();
            }

            var toArrayMethod = t.GetMethod("ToArray", Type.EmptyTypes) ?? t.GetMethod("GetBytes", Type.EmptyTypes) ?? t.GetMethod("GetContent", Type.EmptyTypes);
            if (toArrayMethod != null)
            {
                var o = toArrayMethod.Invoke(att, null);
                if (o is byte[] bb) return bb;
            }
        }
        catch
        {
            // swallow here; caller logs context
        }
        return null;
    }

    /// <summary>
    /// Attempts to determine size/length of an attachment, falling back to byte extraction.
    /// </summary>
    private static long? TryGetAttachmentSize(object att)
    {
        try
        {
            var bytes = TryGetAttachmentBytes(att);
            if (bytes != null) return bytes.LongLength;
            var sizeProp = att.GetType().GetProperty("Size") ?? att.GetType().GetProperty("Length");
            if (sizeProp != null)
            {
                var v = sizeProp.GetValue(att);
                if (v is long l) return l;
                if (v is int i) return (long)i;
            }
        }
        catch { }
        return null;
    }

    /// <summary>
    /// Accept both DELETE and POST (fallback) and consume JSON.
    /// Removes an attachment from a PDF loaded from the supplied base64 payload.
    /// </summary>
    [HttpPost("DeleteFile")]
    public IActionResult DeleteFile([FromBody] DeleteRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.Base64) || string.IsNullOrWhiteSpace(req.FileName))
            return BadRequest("Invalid data");

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

        using (var mainStream = new MemoryStream(bytes))
        using (var loadedDocument = new PdfLoadedDocument(mainStream))
        {
            var name = req.FileName;
            var attachments = loadedDocument.Attachments;
            if (attachments != null)
            {
                for (int i = attachments.Count - 1; i >= 0; i--)
                {
                    var attachment = attachments[i];
                    var fileName = TryGetStringProperty(attachment, "FileName") ?? TryGetStringProperty(attachment, "Name") ?? attachment?.ToString();
                    if (!string.IsNullOrWhiteSpace(fileName) && string.Equals(Path.GetFileName(fileName), Path.GetFileName(name), StringComparison.OrdinalIgnoreCase))
                    {
                        loadedDocument.Attachments.RemoveAt(i);
                        break;
                    }
                }
            }
        }

        try
        {
            return Ok(new { success = true, fileName = req.FileName });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting file {File}", req.FileName);
            return StatusCode(500, new { message = "Failed to delete file", detail = ex.Message });
        }
    }



    [HttpPost("MergeSanction")]
    public IActionResult MergeSanction([FromBody] MergeSanctionRequest req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.FileName))
            return BadRequest(new { message = "fileName is required" });

        try
        {
            var dataDir = DataDirectory; // use Data folder
            Directory.CreateDirectory(dataDir);

            var baseName = req.FileName.Trim();
            if (!baseName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                baseName += ".pdf";

            var applicationPath = Path.Combine(dataDir, baseName);
            if (!System.IO.File.Exists(applicationPath))
                return NotFound(new { message = $"Application PDF not found: {baseName}" });

            var sanctionTemplate = Path.Combine(dataDir, "Sanction_Letter.pdf");
            if (!System.IO.File.Exists(sanctionTemplate))
                return NotFound(new { message = "Sanction_Letter.pdf not found in Data folder" });

            var mergedName = Path.GetFileNameWithoutExtension(baseName) + "_Sanction_Merged.pdf";
            var mergedPath = Path.Combine(dataDir, mergedName);

            using (var finalDoc = new PdfDocument())
            using (var s1 = new FileStream(applicationPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var s2 = new FileStream(sanctionTemplate, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                Stream[] streams = new Stream[] { s1, s2 };
                PdfDocumentBase.Merge(finalDoc, streams);
                using var output = new FileStream(mergedPath, FileMode.Create, FileAccess.ReadWrite, FileShare.Read);
                finalDoc.Save(output);
            }

            return Ok(new { fileName = mergedName });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = "Merge failed", detail = ex.Message });
        }
    }
}
// DTOs and helper classes (unchanged logic, documented)

/// <summary>
/// Request payload for saving a filled PDF and attachments.
/// </summary>
public class SaveFilledRequest
{
    public string? Base64 { get; set; }
    public string? FileName { get; set; }
    public string? DocumentId { get; set; }
    public string? Username { get; set; }
    public string? CustomerName { get; set; }
    public string? Status { get; set; }
    public List<AttachmentDto>? Attachments { get; set; }
}

/// <summary>
/// Request for updating file status in the index.
/// </summary>
public class UpdateStatusRequest
{
    public string DocumentId { get; set; }   // preferred
    public string FileName { get; set; }     // optional fallback
    public string Status { get; set; }       // required: "APPROVED" / "REJECTED" / etc.
}

/// <summary>
/// Index entry describing a saved file.
/// </summary>
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

/// <summary>
/// Attachment descriptor supplied by the client.
/// </summary>
public class AttachmentDto
{
    public string? Name { get; set; }
    public string? Base64 { get; set; }
    public string? Type { get; set; }
    public string? OriginalName { get; set; }
    public long? Size { get; set; }
}

/// <summary>
/// Request used by DeleteFile endpoint; contains the file name to remove and the base64 PDF payload.
/// </summary>
public class DeleteRequest { public string FileName { get; set; } public string? Base64 { get; set; } }

public class MergeSanctionRequest { public string FileName { get; set; } }