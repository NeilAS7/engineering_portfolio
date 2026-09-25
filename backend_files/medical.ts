// Will connect to the backend and make requests, collect data, and send responses to the client
import express from 'express';  // This allows us to create routes using express
import { ombricAppSupabase } from '../supaclient'  // To connect to the database and interact with it
import { requireAuth } from "../middleware";  // To use the reusable user validation middleware function
import { z } from 'zod';  // Import zod for schema validation

const router = express.Router(); // Creating the router object that allows us to define routes

// Middleware: extract user ID from supabase | We call the external file (middleware.ts) that handles the middleware authorization logic to check if the user is authenticated and extract the user info from the token, then attach it to the request object for use in the route handlers | This is used for all routes in this file since it's called at the router level
// Because it has router.use, it tells the middleware to run this function first before the route handlers below | Tells file to run from top to bottom, so it will run the middleware first before any of the route handlers, ensuring that the user info is extracted and available in the request object for all route handlers below
router.use(requireAuth);

router.post('/patientSessionsEdit', async (req, res) => {
    try {
        // Method check
        if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
            return res.status(405).json({ error: "Method not allowed" });
        }

        const { patientID, entryID, prevSession } = req.body; // Collect the data from the request body

        if (!patientID.trim() || !entryID.trim() || !prevSession) {
            console.error('Missing required fields in request body');
            return res.status(400).json({ error: "Missing required fields" });
        }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

        const arraySchema = z.object({
            patientID: z.string().min(1),
            entryID: z.string().min(1),

            prevSession: z.array(
                z.object({ key: z.string(), text: z.string() }),
            ), // Checks that the array contains objects with key and text properties
        }); // Define a schema for validating the signup data using zod | This ensures that the data adheres to the expected format and constraints, providing an additional layer of validation beyond just checking for presence and basic types

        const zodData = { patientID, entryID, prevSession }; // Create an object with the extracted

        const zodResult = arraySchema.safeParse(zodData); // Have zod basically check against the defined shapes of the current values

        if (!zodResult.success) {
            // Means that shapes don't match => return error to frontend to catch
            return res.status(400).json({ error: "Invalid request data" });
        }

        const validData = zodResult.data; // Return the checked data to use for filtering logic (we can be confident that the data is valid and in the correct shape since we checked it with zod)


        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('logs')  // Specify the table to update
            .update({ prevSessions: validData.prevSession })  // Insert a new row with the relevant data for analytics and tracking
            .eq('user_id', validData.patientID)  // Match the user ID to ensure the correct row is updated with the analytics data
            .eq('entry_id', validData.entryID);  // Match the entry ID to ensure the correct row is updated with the analytics data

        if (error) {
            console.error('Failed to update patient profile data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to update user profile data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true });  // Return a success response if the data is updated successfully

    } catch (error) {
        console.error('Unexpected error in updating patient profile data route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

router.post('/patientSessionsFetch', async (req, res) => {
    // Method check
    if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { patientID, entryID } = req.body; // Collect the data from the request body

    if (!patientID || typeof patientID !== 'string' || !patientID.trim() || !entryID || typeof entryID !== 'string' || !entryID.trim()) {  // Data validation
        console.error('Missing required fields in request body');
        return res.status(400).json({ error: "Missing required fields" });
    }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

    try {
        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { data: userData, error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('logs')  // Specify the table to collect from
            .select('prevSessions')  // What to collect
            .eq('user_id', patientID)  // Match the user ID to ensure the correct row is collected
            .eq('entry_id', entryID)  // Match the entry ID to ensure the correct row is collected
            .single();  // Since we expect only one row to match the user ID and entry ID, we can use .single() to return a single object instead of an array


        if (error || !userData) {
            console.error('Failed to collect patient sessions data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to collect patient sessions data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true, userData });  // Return a success response if the data is collected successfully

    } catch (error) {
        console.error('Unexpected error in fetching patient sessions data route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

router.post('/patients', async (req, res) => {
    // Method check
    if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { patientID } = req.body; // Collect the data from the request body

    if (!patientID || !Array.isArray(patientID) || patientID.length === 0) {
        console.error('Missing array of patient IDs in request body');
        return res.status(400).json({ error: "Missing required fields" });
    }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

    try {
        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { data: userData, error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('user_data')  // Specify the table to update
            .select('user_id, email, first_name, last_name, gender, date_of_birth')  // Insert a new row with the relevant data for analytics and tracking
            .in('user_id', patientID);  // Match the user ID to ensure the correct row is updated with the analytics data | the .in allows us to match against an array of patient IDs to fetch the relevant data for each patient in one query instead of having to make multiple queries for each patient ID which is more efficient and faster and then return the results in an array


        if (error || !userData) {
            console.error('Failed to collect patient profile data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to collect patient profile data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true, userData });  // Return a success response if the data is collected successfully

    } catch (error) {
        console.error('Unexpected error in fetching patient profile data route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

router.post('/injuries', async (req, res) => {
    // Method check
    if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { patientID } = req.body; // Collect the data from the request body

    if (!patientID || !Array.isArray(patientID) || patientID.length === 0) {
        console.error('Missing array of patient IDs in request body');
        return res.status(400).json({ error: "Missing array of patient IDs in request body" });
    }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

    try {
        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { data: injuriesData, error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('past_injuries')  // Specify the table to update
            .select('user_id, title, occurrences, recent_year')  // Insert a new row with the relevant data for analytics and tracking
            .in('user_id', patientID);  // Match the user ID to ensure the correct row is updated with the analytics data


        if (error || !injuriesData) {
            console.error('Failed to collect injuries data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to collect injuries data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true, injuriesData });  // Return a success response if the data is collected successfully

    } catch (error) {
        console.error('Unexpected error in fetching injuries data route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

router.post('/medConditions', async (req, res) => {
    // Method check
    if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { patientID } = req.body; // Collect the data from the request body

    if (!patientID || !Array.isArray(patientID) || patientID.length === 0) {
        console.error('Missing array of patient IDs in request body');
        return res.status(400).json({ error: "Missing required fields" });
    }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

    try {
        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { data: conditionsData, error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('med_conditions')  // Specify the table to update
            .select('user_id, title')  // Insert a new row with the relevant data for analytics and tracking
            .in('user_id', patientID);  // Match the user ID to ensure the correct row is updated with the analytics data


        if (error || !conditionsData) {
            console.error('Failed to collect conditions data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to collect conditions data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true, conditionsData });  // Return a success response if the data is collected successfully

    } catch (error) {
        console.error('Unexpected error in fetching medical conditions route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

router.post('/medications', async (req, res) => {
    // Method check
    if (req.method !== "POST") {  // Verifies that the request method is POST => otherwise throw an error
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { patientID } = req.body; // Collect the data from the request body

    if (!patientID || !Array.isArray(patientID) || patientID.length === 0) {
        console.error('Missing array of patient IDs in request body');
        return res.status(400).json({ error: "Missing array of patient IDs in request body" });
    }  // Anything missing => Return a 400 Bad Request response to indicate that the request is malformed and all required fields must be provided for processing the analytics data

    try {
        // Supabase client checks
        if (!ombricAppSupabase) {  // Verifies that supabase client is initialized => otherwise return an error
            return res.status(500).json({ error: "Database client not initialized" });
        }

        const { data: medicationsData, error } = await ombricAppSupabase  // Update the column in the database with the feedback data
            .from('medications')  // Specify the table to update
            .select('user_id, title, description')  // Insert a new row with the relevant data for analytics and tracking
            .in('user_id', patientID);  // Match the user ID to ensure the correct row is updated with the analytics data


        if (error || !medicationsData) {
            console.error('Failed to collect medications data', error);  // Log any error that occurs during the database operation
            return res.status(500).json({ error: "Failed to collect medications data" });  // Return an error response if the database operation fails
        }

        return res.status(200).json({ success: true, medicationsData });  // Return a success response if the data is collected successfully

    } catch (error) {
        console.error('Unexpected error in fetching medications data route', error);  // Log any unexpected error that occurs during the API request handling
        return res.status(500).json({ error: "Internal server error" });  // Return a generic error response for any unexpected errors
    }
});

export default router;  // Export the router so it can be used in other parts of the application