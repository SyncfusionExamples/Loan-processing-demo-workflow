namespace AuthenticationService.Models
{

    /// <summary>
    /// Represents a user with basic authentication details.
    /// </summary>

    public class User
    {
        /// <summary>
        /// Gets or sets the username of the user.
        /// </summary>
        public string? Username { get; set; }

        /// <summary>
        /// Gets or sets the email address of the user.
        /// </summary>
        public string Email { get; set; }

        /// <summary>
        /// Gets or sets the password of the user.
        /// </summary>
        public string Password { get; set; }
    }
}
