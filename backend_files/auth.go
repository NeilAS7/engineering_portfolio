package handlers // Defines all the functions to be called in the file (any function can be called through the handlers - think of as a file with no default export (all named))

import (
	// For os calls

	"splitt-backend/db"

	"github.com/gofiber/fiber/v2"
	supabase "github.com/nedpals/supabase-go" // Supabase go-client import (same as general imports such as in TS)
)

type AuthInput struct { // Setup the type definition of the expected input structure from the frontend
	Email    string `json:"email"` // The json basically maps the key-value pair in the expected JSON from the frontend
	Password string `json:"password"`
}

func HealthCheck(c *fiber.Ctx) error { // This sets up the health check that tells us the backend is up and running | //? Might out-source as to not clutter this file
	return c.JSON(fiber.Map{ // Builds a JSON objects quick to return to the frontend
		"status":  "ok",
		"service": "spliTT-backend",
	})
}

func SignUp(c *fiber.Ctx) error { // This sets up the function with error tracking (important for return status)
	var input AuthInput
	if err := c.BodyParser(&input); err != nil { // The body parser breaks down the input to ensure it matches the expected structure
		return c.Status(400).JSON(fiber.Map{"error": "Invalid Input"})
	}

	user, err := db.Client.Auth.SignUp(c.Context(), supabase.UserCredentials{ // Signs the user up | uses the global supabase client through db.Client with Client being the variable with the client attached to it
		Email:    input.Email,
		Password: input.Password,
	})

	if err != nil { // If there is an error => Return to the frontned
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	// Execute query using the nedpals/supabase-go SDK
	var userData map[string]interface{} // Initialize a variable in order to store the results of the insert | Can use same variable for same reason as using c, pointer views each one uniquely in memory

	err = db.Client.DB.From("user_data").
		Insert(map[string]interface{}{
			"user_id": user.ID,
			"email":   input.Email,
			"theme":   "light",
			"consent": false,
		}).
		Execute(&userData) // Despite not receiving data, the method if backend interaction expects a variable to load the receiving payload from supabase to

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to create new profile: " + err.Error()})
	}

	return c.Status(201).JSON(fiber.Map{
		"success": true,
		"user":    user, //! Change to confirmation message
	})
}

// Same as the signup function expect now for login
func Login(c *fiber.Ctx) error {
	var input AuthInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid Input"})
	}

	session, err := db.Client.Auth.SignIn(c.Context(), supabase.UserCredentials{
		Email:    input.Email,
		Password: input.Password,
	})

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	// Extract the user object from session and set to the constant
	user := session.User

	// Destination variable to store the row fetched from Postgres
	var userData map[string]interface{} // Initialize the variable

	// Execute query using the nedpals/supabase-go SDK
	err = db.Client.DB.From("user_data").
		Select("*").
		Single().
		Eq("user_id", user.ID).
		Execute(&userData) // Connect the data to the variable

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to fetch profile info: " + err.Error()})
	}

	return c.Status(200).JSON(fiber.Map{
		"session": session,
		"user":    userData,
	})
}