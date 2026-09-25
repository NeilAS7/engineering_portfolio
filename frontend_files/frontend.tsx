"use client"; // Tells Next.js to use CSR (client-side rendering) - to run on the client not the server | Runs on the client's browser (ex. arc) rather than on my machine (the server)
import { useEffect, useState, useRef } from "react";
import styles from '../base.module.css'; // Importing CSS module styles from base.module.css - This allows us to use scoped CSS styles for this component
import sessionStyles from "./session.module.css"; // Importing CSS module styles from Home.module.css - This allows us to use scoped CSS styles for this component
import Image from "next/image"; // Importing the Image component from Next.js - This allows us to optimize images in our Next.js app
import Link from "next/link"; // Importing the Link component from Next.js - This allows us to create client-side navigation links in our Next.js app
import ProtectedRoute from "../../../hooks/useProtectedRoute";  // To properly protect this route from unauthenticated users
import { supabase } from '../../../supabaseClient';  // To interact with the database
import { useSearchParams } from "next/navigation";  // To extract from the url any parameters
import { useTheme } from "../../../context/ThemeContext";  // For the theme to change the clipboard icon
import { apiUrl } from "../../../utils/api";  // To use adaptive routing
import posthog from "posthog-js";
import { handleDebug, handlePerformance, handleAudit } from "../../../utils/internalBlocks";
import getUser from "../../../utils/user";
import UserID from "../../../hooks/useId";
import LoadingState from '../loading';  // To show the loading screen while the user's info and session info is being fetched from the database to avoid showing an empty page or the wrong info while the data is being fetched and updated in the state variables
import { updatePrevSessions, getPrevSessions } from "../../../utils/clientSessions";  // For closing the loop new sessions integration with the patients
import { newSessionNote, updateSessionNote, deleteAssignment, createNewAssignment, updateAssignment } from "../../../utils/closeLoop";  // Close the loop functions for creating a new session note, updating a session note, deleting an assignment, creating a new assignment, and updating an assignment to allow the clinician to easily manage the patient's history and treatment plan for better continuity of care and more personalized AI outputs based on the patient's history and current treatment plan
import ClientLayout from "../client-layout";
import UseToken from '../../../hooks/useToken'
import { signedFile } from '../../../utils/user';

// Helper function to convert a string to title case | replace first letter as upper, and rest as lower
function toTitleCase(str: string) {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
}

type userInputTherapy = {
  description: string;
  duration: number;
  severity: string;
  muscle_groups: string;
  follow_up: string;
}

type userInputConcussion = {
  description: string;
  duration: number;
  severity: string;
  concussion_info: {
    symptoms: string[];
    results: string;
    description: string;
    pastConcussion: boolean;
    prevConcussions: {
      title: string;
      occurrences: number;
      recent_year: number;
    }
  }
}

// Set the type definition for the session | To make life easier to collect and reference parts
type Session = {
  id: string;
  clinic_id: string;
  clinician_id: string;
  patient_name: string;
  created_at: number;
  pdf: string;
  so_notes: string;
  ai_summary: string;
  muscles: string;
  status: string;
  ai_output: string;
  feedback: string;
  feedbackInputs: string;
  sanitized_pdf: string;
  patient_id: string;
  consent: boolean;
  prevSessions: prevSessions;  // Expected format
  entry_id: string;
  assignments: clientAssignments;
  mode: string;
  user_inputs: userInputTherapy | userInputConcussion | any;  // To store the user's input for the session based on the mode of the session, which allows us to reference the user's input for the session for display and for sending to the AI when generating the summary and SOAP notes to provide more personalized outputs based on the patient's specific situation and history
}

type SOAP = {  // Type definition for SOAP notes
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

type prevSessions = {  // Type definitions for multi-session notes array
  key: string;
  text: string;
}[]

type clientAssignments = {
  key: string;
  title: string;
  description: string;
  times: number | null;
  hours: number | null;
  weeks: number | null;
  reps: number | null;
  fileUrl?: string | null;
  deletedAt: Date | null;
}[]

export default function Session() {
  const { user, loading } = ProtectedRoute();  // Calling the protected route
  const [userLoad, setUserLoad] = useState(false);  // To slow the page load for smoothness
  const [dataLoad, setDataLoad] = useState(false);  // To slow the page load for smoothness while fetching data
  const clinicianId = UserID();  // Getting the clinician ID
  const searchParams = useSearchParams();  // For extracting url parameters
  const [error, setError] = useState('');  // For displaying the errors
  const [success, setSuccess] = useState('');  // For displaying the success messages
  const { theme } = useTheme();  // For the theme (to change the clipboard based on the theme)
  const [sessionView, setSessionView] = useState<'data' | 'ai' | 'closeLoop'>('data')
  const token = UseToken();  // For getting the token from local storage

  const [fullName, setFullName] = useState('');  // Display the clinician's full name
  const [clinicName, setClinicName] = useState('');  // For displaying the clinic name
  const [clinicId, setClinicId] = useState(''); // For querying the clinics table
  const [clinicCode, setClinicCode] = useState('');  // For sending to the backend for analytics and tracking | The clinic's short name

  // Recording
  const [recording, setRecording] = useState(false);  // For tracking if the recording is on or off
  const [transcript, setTranscript] = useState('');  // To store the AI transcript for the session
  const [sensitiveScript, setSensitiveScript] = useState('');  // To store the sensitive info extracted from the transcript to send to the backend for debugging and analysis (not displayed on the frontend to protect patient privacy)
  const streamRef = useRef<MediaStream | null>(null);  // Creates a ref to store the MediaStream instance, allowing us to persist the same MediaStream across re-renders without causing unnecessary re-initializations and to properly stop the stream when needed
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);  // Creates a ref to store the MediaRecorder instance, allowing us to persist the same MediaRecorder across re-renders without causing unnecessary re-initializations and to properly stop the recording when needed
  const chunksRef = useRef<Blob[]>([]);  // Creates a ref to store the audio data chunks collected from the MediaRecorder, allowing us to accumulate the audio data during the recording process and create a complete audio Blob when the recording is stopped for processing and transcription by the backend

  // Session info
  const [sessionId] = useState(searchParams ? searchParams.get('sessionId') || '' : '');  // Collect the session ID from the search params
  const [session, setSession] = useState<Session | null>(null);  // For storing the session info to the type definiton
  const [clientName, setClientName] = useState('');  // Set the client's name attached to the session
  const pdfRef = useRef<HTMLIFrameElement>(null);
  const [userConsent, setUserConsent] = useState(false);  // For tracking the consent status of the session to determine whether to show the PDF or not (if no consent, then we hide the PDF and show a message saying that the PDF is hidden due to lack of consent to protect patient privacy)
  const [soapInfo, setSOAPInfo] = useState<SOAP>({ subjective: '', objective: '', assessment: '', plan: '' });  // To store the different sections of the SOAP note extracted from the AI output for easier reference and display on the page

  // Closing the loop
  const [prevSessionsPro, setPrevSessionsPro] = useState<prevSessions>([]);  // To store the previous sessions for the patient for display on the frontend and reference for the AI when generating the summary and SOAP notes to provide better continuity of care and more personalized outputs based on the patient's history, which can enhance the relevance and usefulness of the AI's outputs for the clinician reviewing the session information
  const [prevSessionsUser, setPrevSessionsUser] = useState<prevSessions>([]);  // To store the previous sessions for the patient for display on the frontend and reference for the AI when generating the summary and SOAP notes to provide better continuity of care and more personalized outputs based on the patient's history, which can enhance the relevance and usefulness of the AI's outputs for the clinician reviewing the session information
  const [selectedPrevSession, setSelectedPrevSession] = useState<prevSessions | null>(null);  // To track the selected previous session for display of the session info when the user clicks on a previous session button to show the info for that session, which allows the clinician to easily reference past session information for the patient to inform their review of the current session and provide better continuity of care based on the patient's history
  const [sessionNote, setSessionNote] = useState('');  // To track the session note input for the new session to be added to the previous sessions array when starting a new session, which allows the clinician to input relevant information about the session that can be referenced in future sessions for better continuity of care and more personalized AI outputs based on the patient's history
  const [clientAssignments, setClientAssignments] = useState<clientAssignments>([]);  // To store the client's assignments for display on the frontend and reference for the AI when generating the summary and SOAP notes to provide better continuity of care and more personalized outputs based on the patient's history and current treatment plan, which can enhance the relevance and usefulness of the AI's outputs for the clinician reviewing the session information
  const [selectedAssignment, setSelectedAssignment] = useState<clientAssignments | null>(null);  // To track the selected assignment for display of the assignment info when the user clicks on an assignment button to show the info for that assignment, which allows the clinician to easily reference the client's assignments for better understanding of the patient's treatment plan and to inform their review of the current session and provide better continuity of care based on the patient's history and current treatment plan
  const [signedURL, setSignedURL] = useState('');  // For the safe to use URL for the file attached to the assignment

  // Voting System
  const [vote, setVote] = useState<'good' | 'bad' | null>(null);  // For tracking the vote status
  const [voteBox, setVoteBox] = useState(false);  // For tracking the vote box status
  const [voteTemplates, setVoteTemplates] = useState<string[]>([]);  // For storing the vote template options to display in the vote box
  const [selectedTemplate, setSelectedTemplate] = useState<string[]>([]);  // For tracking the selected template in the vote box
  const [voteFeedback, setVoteFeedback] = useState('');  // For tracking the feedback input in the vote box
  const voteBoxRef = useRef<HTMLDivElement>(null);  // So that we can close the box if the user clicks outside of it

  // AI stuff
  const [structure, setStructure] = useState('');  // The consistent structure to feed the AI
  const [aiTemplates, setAITemplates] = useState<string[]>([]);  // sets the templates to be offered
  const [selectedAITemplates, setSelectedAITemplates] = useState<string[]>([]);  // To store the selected AI templates
  const [aiOutput, setAIOutput] = useState('');  // The AI output to display on the page and to save to the database

  // Load states as to disable buttons
  const [transcribeLoad, setTranscribeLoad] = useState(false);
  const [feedbackLoad, setFeedbackLoad] = useState(false);
  const [aiLoad, setAILoad] = useState(false);
  const [consentLoad, setConsentLoad] = useState(false);
  const [soapLoad, setSOAPLoad] = useState(false);
  const [prevLoad, setPrevLoad] = useState(false);
  const [userPrevLoad, setUserPrevLoad] = useState(false);  // To track the loading state of fetching the previous sessions for the patient to disable the previous sessions buttons and show a loading state on the buttons while the data is being fetched to prevent multiple clicks and to provide feedback to the user that the data is being fetched for a better user experience

  // For error and success messages, we set a timer to automatically clear the messages after 5 seconds so that they don't stay on the screen indefinitely and clutter the UI | We also allow the user to click on the message to clear it immediately if they want to
  const showError = (message: string) => {  // Shows error message (takes in the message as a parameter when calling the function)
    setSuccess('');  // Clear success messages
    setError(message);  // Show error (the message passed in parentheses when calling the function)
    window.setTimeout(() => setError(''), 5000);  // Clear after 5 seconds (5000 milliseconds) | So that the error message does not stay on the screen forever
  };

  const showSuccess = (message: string) => {  // Shows success message (takes in the message as a parameter when calling the function)
    setError('');  // Clear errors
    setSuccess(message);  // Show success (the message passed in parentheses when calling the function)
    window.setTimeout(() => setSuccess(''), 5000);  // Clear after 5 seconds (5000 milliseconds) | So that the success message does not stay on the screen forever
  };

  function getErrorDescription(error: any): string {  // Helper function to extract a user-friendly error message from various error formats, ensuring that we can display meaningful error messages to the user regardless of how the error is structured
    if (!error) return 'Unknown error';  // If no error object is provided, return a default message
    if (typeof error === 'string') return error;  // Return the error directly if it's already a string
    if (error.message) return error.message;  // If the error object has a message property, return that message
    try { return JSON.stringify(error); } catch { return String(error); }  // As a last resort, attempt to stringify the error object for a readable format, and if that fails (e.g., due to circular references), convert it to a string using String() to ensure we return some form of error description. This comprehensive approach allows us to handle various error formats gracefully and provide useful feedback for debugging and user communication.
  }

  useEffect(() => {  // Run functions when page mounts
    if (loading || !user) return;  // Wait until AuthContext is done loading
    if (!sessionId) {  // Ensures the session ID is always set
      window.location.href = '/';
      return;
    };

    if (!clinicianId) {  // If no clinician ID, redirect to login page
      showError('No clinician ID found. Please log in again.');  // Show an error message to the user indicating that no clinician ID was found and that they need to log in again, which can help inform the user of the issue and guide them on how to resolve it by re-authenticating, ensuring that they have a valid session and clinician ID to access the session information securely
      window.location.href = '/auth/login';
      return;
    }

    setError('');  // Clear any previous errors
    setUserLoad(true)

    const fetchUserInfo = async () => {  // Function to fetch the user's info
      try {
        if (!clinicianId) return;  // Ensure clinicianId is defined
        const data = await getUser();

        if (error || !data) {
          console.error('Failed to fetch user data', error)
          return;
        }

        const middleInitial = data.middle_name ? `${data.middle_name[0].toUpperCase()}. ` : '';
        const formattedName = `${toTitleCase(data.first_name)} ${middleInitial}${toTitleCase(data.last_name)}`;
        setFullName(formattedName);
        setClinicId(data.clinic_id)  // Set the clinic ID for queries
      } catch (err) {
        console.error('Unexpected error fetching user data', err);
        return
      } finally {
        setUserLoad(false)
      };
    }; fetchUserInfo();  // Call the function to run
  }, [user, loading, clinicianId]); // Dependency array includes user, userTheme, and setTheme

  useEffect(() => {  // We delay this useEffect so that the clinicId is set from the above useEffect | creating a small delay to ensure it loads/saves
    if (!clinicId) {
      return;  // If no clinic ID, return
    }

    const fetchSessions = async () => {
      try {
        const sessionsResponse = await fetch(apiUrl('/sessions/sessionData'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ clinicId, sessionId })
        });

        const sessionData = await sessionsResponse.json();  // Parse the JSON response from the

        if (sessionData.error || !sessionData.success) {
          console.error('Failed to fetch session data', sessionData.error)
          await handleDebug('session', 'Failed to fetch session data', getErrorDescription(sessionData.error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to fetching session data, which is critical for the functionality of this page. By sending the error details to our backend, we can analyze patterns, identify common issues, and improve the overall reliability of our application.
          return;
        }

        // Ensure that data was returned before setting to the constant
        if (sessionData) {
          posthog.capture('pro session viewed')
          setSession(sessionData.sessions);
          setClientName(sessionData.sessions.patient_name);  // To set the patient's name for display
          setVote(sessionData.sessions.feedback);  // To set the previous feedback if there is any
          setPrevSessionsPro(sessionData.sessions.prevSessions);  // To set the previous sessions for display for the pro notes
          setClientAssignments(sessionData.sessions.assignments);  // To set the client's assignments for display and reference
          setAIOutput(sessionData.sessions.ai_output);  // To set to the previous ai output
          setUserConsent(sessionData.sessions.consent);  // To set the user consent status to determine whether to show the PDF or not
        } else {
          console.error('No session data found.')
        }
      } catch (err) {
        console.error('Unexpected error fetching session data', err);
      }
    };

    const updateSession = async () => {
      try {
        const response = await fetch(apiUrl('/sessions/sessionStatus'), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ clinicId, sessionId })
        });

        const results = await response.json();  // Parse the JSON response from the

        if (results.error || !results.success) {
          console.error('Failed to update session status', results.error)
          return;
        }

      } catch (err) {
        console.error('Unexpected error updating session', err);
      }
    };

    const fetchClinicName = async () => {  // Function to fetch the the clinic's name for display
      try {
        const response = await fetch(apiUrl('/sessions/clinic'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ clinicId })
        });

        const data = await response.json()

        if (!data.success || data.error) {
          console.error('Error fetching the clinic name', data.error)
          return;
        }

        setClinicName(data.clinicData.name)
        setClinicCode(data.clinicData.clinic_shortName)  // Set the clinic code for analytics and tracking purposes when sending to the backend
        return;
      } catch (err) {
        console.error('Unexpected error fetching clinic name', err);
      }
    };  // No need to call since it is called in the loadPageData function that runs all the functions together for smoother loading

    const loadPageData = async () => {  // This async function will run all the above functions simultaneously and then stop the loading after they each run (this is for smoother page loads)
      setDataLoad(true);  // Set loading to true while fetching data for smoothness
      try {
        await Promise.all([fetchSessions(), fetchClinicName()]);  // Fetch both the session data and the clinic name in parallel to optimize loading time
        await updateSession();  // Update the session status to "viewed" after fetching the session data to ensure that we have the session information before marking it as viewed
      } finally {
        setDataLoad(false);  // Set loading to false after fetching data
      }
    }; loadPageData();  // Call the function to run
  }, [clinicId, sessionId, clinicianId]); // Dependency array includes clinicId since we need that to fetch the clinic name and the session ID to fetch the particular session info

  useEffect(() => {
    console.log(session?.user_inputs?.concussion_info)
  }, [session])

  useEffect(() => {  // useEffect to format the SOAP notes for frontend ease of display
    setSOAPLoad(true);  // Set loading to true while processing the AI output for smoothness
    const extractSOAP = (output: string): SOAP => {  // Helper function to extract the SOAP components from the AI output, which allows us to structure the AI output in a consistent format and easily reference the different sections of the SOAP note for display and saving to the database  
      const text = (output || "").replace(/\r\n/g, "\n");  // Takes in the text sent to the function (or empty) and replaces any carriage return + newline combinations with just newlines to standardize the formatting of the text, which allows for more consistent parsing of the SOAP sections regardless of how the line breaks were originally formatted in the AI output

      const pick = (startPattern: string, stopPattern: string) => {  // Helper function to extract given the start and end and then cleanup the output
        const re = new RegExp(`${startPattern}\\s*([\\s\\S]*?)\\s*(?=${stopPattern}|$)`, "i");  // Create a regular expression to match the text between the start and stop patterns, ignoring case
        const match = text.match(re);  // Extract the match
        return match?.[1]?.trim() ?? "";  // Cleanup the match by trimming whitespace and return it, or return an empty string if there is no match to ensure that we always return a string value for each section of the SOAP note, which simplifies the handling of the extracted data and avoids issues with undefined values when referencing these sections later in the code for display or saving to the database
      };

      // Repeated process for each section of the SOAP note, with variance handling in the patterns to account for different ways the AI might format the sections (ex. "Subjective Notes:" vs "Subjective:") to make the extraction more robust and adaptable to variations in the AI's output formatting while still accurately capturing the intended sections of the SOAP note for display and reference throughout the user's interactions with the page
      const subjective = pick(  // We call the helper function within to collect the output and then clean it
        "(?:Subjective(?:\\s*notes?)?|S)\\s*:",  // Starts with 'Subjective' followed by optional 'notes' and a colon (if present (variance handling)), with flexible spacing | We use '|S' To be able to handle the cases with 'S: ' (what the AI scribe will generate)
        "(?:Objective(?:\\s*notes?)?|O|Assessment(?:\\s*notes?)?|A|Plan(?:\\s*notes?)?|P)\\s*:"  // Stop at either 'Objective', 'Assessment', or 'Plan' (with optional 'notes' and a colon), with flexible spacing, to capture everything in between as the subjective section
      );

      const objective = pick(
        "(?:Objective(?:\\s*notes?)?|O)\\s*:",
        "(?:Assessment(?:\\s*notes?)?|A|Plan(?:\\s*notes?)?|P)\\s*:"
      );

      const assessment = pick(
        "(?:Assessment(?:\\s*notes?)?|A)\\s*:",
        "(?:Plan(?:\\s*notes?)?|P)\\s*:"
      );

      const plan = pick(
        "(?:Plan(?:\\s*notes?)?|P)\\s*:",
        "$a" // no next section, capture to end
      );

      return { subjective, objective, assessment, plan };  // Return the constants
    };

    if (aiOutput || session?.so_notes) {  // If there is AI output or if there are SO notes from the session (in case there is no AI output but there are SO notes, we can still extract the SOAP info for display and reference)
      const soap = extractSOAP(aiOutput || session?.so_notes || '');  // We extract and pass what we have (AI output takes precedence since it is more likely to be in the correct format and more comprehensive, but if it's not available we can still extract from the SO notes to get the SOAP info for display and reference)
      setSOAPInfo(soap);  // Set the output to the type definition so that we can pick apart and set with ease
    } else {
      setSOAPInfo({ subjective: '', objective: '', assessment: '', plan: '' });  // If no AI output and no SO notes, clear the SOAP info
    }
    setSOAPLoad(false);  // Set loading to false after processing the AI output | For page loading
  }, [session, aiOutput]);  // Dependency array includes session and aiOutput since we want to extract the SOAP info whenever either of those changes, which allows us to keep the SOAP info up to date with the latest AI output and session data for accurate display and reference throughout the user's interactions with the page

  useEffect(() => {  // useEffect to collect the patients previous sessions records
    const fetchPrevSessions = async () => {
      setUserPrevLoad(true);  // Set loading to true while fetching data for smoothness
      try {
        if (!session) return;  // Ensure session is defined

        const data = await getPrevSessions(session.patient_id, session.entry_id);  // Call the reusable function to fetch the previous sessions for the patient based on the patient's name and the current session ID for filtering purposes

        if (data) {
          setPrevSessionsUser(data);  // Set the previous sessions data to state for display and reference
          return;
        } else {
          console.error('No previous sessions data found.');
          return;
        }
      } catch (err) {
        console.error('Unexpected error fetching previous sessions data', err);
      } finally {
        setUserPrevLoad(false);  // Set loading to false after fetching data
      }
    }; fetchPrevSessions();  // Call the function to run
  }, [session]);  // Dependency array includes session since we need the patient's name and the current session ID from the session data to fetch the previous sessions for the patient, which allows us to keep the previous sessions data up to date with the current session information for accurate display and reference throughout the user's interactions with the page

  useEffect(() => {  // useEffect to setup the AI templates on component load
    setAITemplates([
      'SOAP',
      'Initial',
      'Progress',
      'Referral'
    ])
  }, [])

  useEffect(() => {  // useEffect to handle clicks outside of the vote box to close it
    function handleClickOutside(event: MouseEvent) {  // Function to handle clicks outside of the vote box
      if (voteBoxRef.current && !voteBoxRef.current.contains(event.target as Node)) {  // If the click is outside of the vote box
        // set the vote box to false, and reset the selected templates and feedback input
        setVoteBox(false);
        setSelectedTemplate([]);
        setVoteFeedback('');
      }
    }
    if (voteBox) {  // Only add the event listener if the vote box is open, to optimize performance and avoid unnecessary listeners when the box is closed
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {  // Remove the event listener when the component unmounts or when the vote box state changes, to prevent memory leaks and unintended behavior
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [voteBox]);  // Only parameter is the voteBox state since we only want to add the event listener when the box is open, and remove it when it's closed or when the component unmounts

  useEffect(() => {
    if (!selectedAssignment) return;

    const fileURL = selectedAssignment[0].fileUrl ?? '';  // Correctly extract fileURL from selected assignment or use an empty string

    if (!fileURL) return;

    // Set picture token validity
    const lifeSpan = 3600;  // 1 hour lifespan

    async function getSecureUrl() {
      const data = await signedFile(fileURL);

      if (data.error || !data) {
        console.error('Failed to get signed URL', data.error)
        return;
      }

      if (data?.signedUrl) {
        setSignedURL(data.signedUrl)
      }
    }; getSecureUrl();

    // Automatic refresh of signed URL 5-minutes before token expires
    const refreshInterval = lifeSpan - 300;

    const intervalID = setInterval(() => {
      getSecureUrl();
    }, refreshInterval);

    return () => clearInterval(intervalID);  // Clear the interval when the component unmounts
  }, [selectedAssignment]);

  useEffect(() => {  // useEffect to handle vote templates based on the vote value
    if (voteBox) {  // If the vote box is open:
      // Depending on the vote value, set the templates accordingly, otherwise clear the templates
      if (vote === 'good') {
        setVoteTemplates([
          'clear summary',
          'good SO notes',
          'easy to read',
          'saved time'
        ]);
      } else if (vote === 'bad') {
        setVoteTemplates([
          'missing info',
          'unclear',
          'poor wording',
          'too long/short',
          'inaccurate'
        ]);
      } else {
        setVoteTemplates([]);
      }
    }
  }, [voteBox, vote]);

  // To setup the template that is being passed to the AI | Changes based on professional sensitive notes
  useEffect(() => {
    // Type assignments
    let template: string;
    let aiTranscript: string = transcript || '';  // For the transcript that is being sent to the AI, we start with the transcript from the recording, but if there is a sensitive script extracted from the transcript, we append it to provide additional context to the AI for better handling of sensitive information in the input, which can help improve the accuracy and appropriateness of the AI's output when dealing with sensitive topics. This allows us to give the model specific instructions on how to handle sensitive information, which can enhance the safety and reliability of the AI's responses in these cases.

    if (transcript && (typeof sensitiveScript === 'string' && sensitiveScript.trim() !== '')) {  // Verifies that sensitiveScript is a non-empty string | if so => add to the transcript
      aiTranscript = `${transcript} ${sensitiveScript}`;  // If there is a transcript and the sensitive script is enabled, we append the sensitive script to the end of the transcript to provide additional context to the AI model for better handling of sensitive information in the input, which can help improve the accuracy and appropriateness of the AI's output when dealing with sensitive topics. This allows us to give the model specific instructions on how to handle sensitive information, which can enhance the safety and reliability of the AI's responses in these cases.
    }


    if (session?.ai_output && session?.prevSessions || session?.ai_output) {  // This is for handling rewrites for extra sessions to use the current data and theni add the extras
      template = `SESSION CONTINUANCE:\nPrevious AI Output:\n${session.ai_output}${session?.prevSessions ? ("\nSession Notes: " + session.prevSessions) : ""}${prevSessionsUser ? ("\nUser Notes: " + prevSessionsUser) : ""}\n\nAI Summary:\n${session.ai_summary}\n\nAI SO Notes:\n${session.so_notes}\n\nIN-SESSION:\nTranscript:\n${aiTranscript}\n\nSelected Templates:\n${selectedAITemplates}`;
    } else if (session?.ai_summary && session?.muscles && session?.so_notes) {  // For new sessions sent where the user is connected
      template = `PRE-SESSION:\nFormatted Muscles:\n${session.muscles}\n\nAI Summary:\n${session.ai_summary}\n\nAI SO Notes:\n${session.so_notes}\n\nIN-SESSION:\nTranscript:\n${aiTranscript}\n\nSelected Templates:\n${selectedAITemplates}`;
    } else {  // For new sessions where the pro created it (no user attached)
      template = `PRE-SESSION:\nNone recorded\n\nIN-SESSION:\nTranscript:\n${aiTranscript}\n\nSelected Templates:\n${selectedAITemplates}`;
    }

    setStructure(template);
  }, [session, transcript, sensitiveScript, selectedAITemplates]);  // The useEffect is triggered when these variables change

  useEffect(() => {
    const clientAssignmentsFiltered = clientAssignments.filter(item => item.deletedAt === null);
    setClientAssignments(clientAssignmentsFiltered);
  }, [clientAssignments]);

  if (loading || userLoad || dataLoad || soapLoad || userPrevLoad) {
    return <LoadingState />;  // Easier to maintain
  };

  if (!loading && !user) return null;  // If done loading and no user data, return null

  const changeName = async () => {  // Function to change the client's name | This will update the patient's name in the database and update the session state to reflect the change | Triggers on blur (when the input loses focus (clicks outside)) or when the user presses enter in the input field
    setError('');  // Clear previous errors

    try {
      if (!clientName.trim() || !clientName || typeof clientName !== 'string') {  // If the client name is empty after trimming whitespace, show an error message and return early to prevent updating with an empty name
        showError('Client name cannot be empty.');
        return;
      }

      const response = await fetch(apiUrl('/sessions/updateName'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId, clientName })
      });

      const results = await response.json();  // Parse the JSON response from the

      if (results.error || !results.success) {
        console.error('Failed to update the client\'s name', results.error)
        showError('Failed to update client\'s name, please try again.')
        return;
      } else {
        if (!user?.clinician_id) return;
        await handleAudit({
          actorId: user?.clinician_id,
          actorEmail: user?.email,
          actionType: 'MUTATE_RECORD',
          patientId: session?.patient_id,
          description: `User changed name on session with ID: ${sessionId}`
        });
      }
    } catch (err) {
      console.error('Unexpected error updating client name', err);
      showError('Failed to update client\'s name, please try again.');
      return;
    }
  };

  const handleFullScreen = () => {  // Function to handle the full screen action for the PDF | This will make the PDF go into full screen mode when the user clicks the full screen icon
    if (pdfRef.current) {
      // For the browser compatibility, we check for the different methods to request full screen and call the appropriate one based on the browser
      if (pdfRef.current.requestFullscreen) {
        // Most modern browsers
        pdfRef.current.requestFullscreen();
      } else if ((pdfRef.current as any).webkitRequestFullscreen) {
        // Safari
        (pdfRef.current as any).webkitRequestFullscreen();
      } else if ((pdfRef.current as any).msRequestFullscreen) {
        // IE11
        (pdfRef.current as any).msRequestFullscreen();
      }
    }
  };

  const handleVote = async (voteValue: 'good' | 'bad' | null) => {  // Function to handle the voting action
    setVote(voteValue);  // set the vote value to the one passed when the function is called

    try {
      const response = await fetch(apiUrl('/sessions/submitVote'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId, voteValue })
      });

      const results = await response.json();  // Parse the JSON response from the

      if (results.error || !results.success) {
        console.error('Failed to submit vote', results.error);
        showError('Failed to submit vote, please try again.');
      }
    } catch (err) {
      console.error('Unexpected error while submitting vote', err);
      showError('An unexpected error occurred while submitting vote, please try again.');
    }
  };

  const submitFeedback = async () => {  // Submit the feedback from the vote box to the database
    if (!selectedTemplate && !voteFeedback.trim()) {  // If no template is selected and no feedback is provided, show an error message and return early
      showError('Please select at least one template and/or provide feedback.');
      return;
    }

    setFeedbackLoad(true);  // Set the loading state for the feedback submission process to true to disable the submit button and show the loading indicator

    try {
      const feedbackData = {  // Set both the template and the feedback input into an object to save to the database | set to a combine string
        selected_templates: selectedTemplate,
        additional_feedback: voteFeedback
      };

      const response = await fetch(apiUrl('/sessions/submitFeedback'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId, feedbackData })
      });

      const results = await response.json();  // Parse the JSON response from the

      if (results.error || !results.success) {
        console.error('Failed to submit feedback', results.error);
        showError('Failed to submit feedback, please try again.');
        await handleDebug('feedback', 'Failed to submit feedback', getErrorDescription(error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to submitting feedback, which is critical for understanding user satisfaction and improving our service. By sending the error details to our backend, we can analyze patterns, identify common issues, and enhance the overall reliability of our feedback submission process.
        return;
      };

      // Otherwise, if successful, show success message and reset the vote box and its inputs
      showSuccess('Feedback submitted successfully!');
      setVoteBox(false);
      setSelectedTemplate([]);
      setVoteFeedback('');

      const userId = user?.access_token || '';  // Get the user ID from the user object for analytics tracking
      if (session?.mode === 'concussion') {  // Have it change based on if it is concussion mode
        const response = await fetch(apiUrl('/analytics'), {  // When the pro submits feedback, add the data to ombric data platform for analytics | This is done through an API route since we use the secret key and don't want to expose it
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userId}`  // Send the user ID in the Authorization header to ensure proper authentication
          },
          body: JSON.stringify({  // Send the relevant data in the request body as JSON
            clinicCode,
            vote,
            pdf: session?.sanitized_pdf || '',
            so_notes: session?.so_notes || '',
            pro_feedback: feedbackData,
            clinic_id: clinicId,
            user_inputs: session?.user_inputs || null,
            clinicianId,
            mode: session?.mode
          })
        });
        const result = await response.json();  // Collect the response from the API route to check if the submission was successful for debug purposes
        if (result.success) {
          console.log('Analytics data submitted successfully');
        } else {
          console.error('Failed to submit analytics data', result.error);
          await handleDebug('feedback', 'Failed to submit feedback', getErrorDescription(result.error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to submitting feedback, which is critical for understanding user satisfaction and improving our service. By sending the error details to our backend, we can analyze patterns, identify common issues, and enhance the overall reliability of our feedback submission process.
          return;
        }
      } else {
        const response = await fetch(apiUrl('/analytics'), {  // When the pro submits feedback, add the data to ombric data platform for analytics | This is done through an API route since we use the secret key and don't want to expose it
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userId}`  // Send the user ID in the Authorization header to ensure proper authentication
          },
          body: JSON.stringify({  // Send the relevant data in the request body as JSON
            clinicCode,
            vote,
            ai_summary: session?.ai_summary || '',
            pdf: session?.sanitized_pdf || '',
            so_notes: session?.so_notes || '',
            pro_feedback: feedbackData,
            clinic_id: clinicId,
            user_inputs: session?.user_inputs || null,
            clinicianId,
            mode: session?.mode
          })
        });
        const result = await response.json();  // Collect the response from the API route to check if the submission was successful for debug purposes
        if (result.success) {
          console.log('Analytics data submitted successfully');
        } else {
          console.error('Failed to submit analytics data', result.error);
          await handleDebug('feedback', 'Failed to submit feedback', getErrorDescription(result.error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to submitting feedback, which is critical for understanding user satisfaction and improving our service. By sending the error details to our backend, we can analyze patterns, identify common issues, and enhance the overall reliability of our feedback submission process.
          return;
        }
      }
    } catch (error) {
      console.error('Unexpected error while submitting feedback', error);
      showError('An unexpected error occurred while submitting feedback, please try again.');
      await handleDebug('feedback', 'Failed to submit feedback', getErrorDescription(error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to submitting feedback, which is critical for understanding user satisfaction and improving our service. By sending the error details to our backend, we can analyze patterns, identify common issues, and enhance the overall reliability of our feedback submission process.
      return;
    } finally {
      setFeedbackLoad(false);  // Set the loading state for the feedback submission process back to false to re-enable the submit button and hide the loading indicator
    };
  };

  const handleCopyToClipboard = () => {  // Function to handle copying the AI output to the clipboard when the user clicks the clipboard icon
    if (aiOutput) {  // If there is AI output to copy
      navigator.clipboard.writeText(aiOutput)  // Use the Clipboard API to write the AI output text to the clipboard
      posthog.capture('pro copied output to clipboard')
      setSuccess('AI output copied to clipboard!');  // Show success message
      showSuccess('AI output copied to clipboard!');  // Show success message
    } else {  // Otherwise nothing to copy => showError
      showError('No AI output to copy to clipboard.');
    }
  };

  const handleRecordClick = async () => {  // Function that handles the audio collection (recording)
    try {
      if (!recording) {  // If recording (the button triggers this) => log in console and start the recording using the recorder instance that was set up in the useEffect, which accesses the user's microphone and starts recording the audio stream
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });  // Ask for permission if needed | Returns the audio stream
        streamRef.current = stream;  // Store the stream in the ref | This is the live audio being collected
        chunksRef.current = [];  // Clear the chunks ref to prepare for new recording data | This ensures that we don't have leftover audio data from previous recordings, which could cause issues with the current recording session. By clearing the chunks at the start of a new recording, we ensure that we are only collecting and processing the audio data from the current session, leading to
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 });  // Create a new MediaRecorder instance with the audio stream to handle the recording process and collect the audio data in chunks | 2 parameters: the audio stream to record (the live audio being collected), and the options object where we specify the MIME type for the recorded audio to ensure compatibility and optimal quality for transcription by the backend (this audio type enables for longer recordings without issues and is widely supported for web audio recording) | MediaRecorder is the browser API that allows us to record audio (and video) from the user's device, and it provides an easy way to collect the recorded data in chunks through event listeners, which we can then process and send to our backend for transcription, we also set the bits per second to 16000 to ensure good quality audio for transcription while keeping the file size manageable, which is important for performance and to meet the requirements of the Whisper API on the backend (this gets us more record time without hitting file size limits, and ensures the audio quality is sufficient for accurate transcription)
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); }; // Set up an event listener for when there is audio data available from the recording, which will be triggered periodically as the recording progresses and will allow us to collect the audio data in chunks for processing | This is because the MediaRecorder API provides the recorded audio data in chunks through the dataavailable event, and by pushing these chunks into the chunksRef array, we can accumulate the complete audio recording over time and create a Blob from these chunks when the recording is stopped for transcription by the backend
        mediaRecorder.start();  // Start the recording process
        mediaRecorderRef.current = mediaRecorder;  // Store the MediaRecorder instance in the ref so that we can access it later to stop the recording and process the collected audio data when the user clicks the button again to stop recording
        setRecording(true);  // Set the recording state to true to indicate that recording is in progress and to change the button text to "Stop Recording"
        if (!user?.clinician_id) return;
        await handleAudit({
          actorId: user?.clinician_id,
          actorEmail: user?.email,
          actionType: 'MUTATE_RECORD',
          patientId: session?.patient_id,
          description: `User changed began recording on session with ID: ${sessionId}`
        });
      } else {  // Otherwise when recording is true, this block now stops the recording process and processes the collected audio data to send to the backend for transcription when the user clicks the button again to stop recording
        if (mediaRecorderRef.current) {  // Ensure mediaRecorder is not null before accessing its methods
          mediaRecorderRef.current.stop();  // Stop the MediaRecorder instance to end the recording process and trigger the final collection of audio data
          mediaRecorderRef.current.onstop = async () => {  // Set up an event listener for when the MediaRecorder instance is stopped, which will be triggered when the recording is stopped and will allow us to process the collected audio data and send it to the backend for transcription
            try {
              const blob = new Blob(chunksRef.current, { type: 'audio/webm' });  // Create a new Blob from the collected audio data chunks, which will represent the complete recorded audio and can be sent to the backend for transcription | Blob is a web API that represents binary data in a file-like object, and by creating a Blob from the collected audio chunks, we can easily send this audio data to our backend for processing and transcription by the Whisper API. The type specified in the Blob constructor should match the MIME type used when setting up the MediaRecorder to ensure compatibility and proper handling of the audio data. This step is crucial for converting the raw audio data collected in chunks into a format that can be transmitted and processed effectively by our backend services.
              streamRef.current?.getTracks().forEach(t => t.stop());  // Stop all tracks of the audio stream to release the microphone and end the recording session properly, which is important for user privacy and to allow for new recordings in the future without issues
              streamRef.current = null;  // Clear the stream ref since the stream is stopped | Clears any remaining audio stream data from the ref to ensure that we don't have any lingering references to the stopped stream, which could cause issues with future recordings or memory leaks. By setting the stream ref to null, we indicate that there is no active audio stream, and we can safely start a new recording session when the user clicks the record button again without any conflicts from previous streams.

              const MAX_FILE_SIZE = 25 * 1024 * 1024;  // Set a maximum file size for the recording (in bytes) to prevent excessively large recordings that could cause performance issues or exceed backend processing limits. If the recording size exceeds this limit, we can show an error message to the user and discard the recording to ensure a better user experience and system reliability. | This is the max that the Whispr API can handle
              if (blob.size > MAX_FILE_SIZE) {  // If the recording size exceeds the maximum limit, show an error message and return early without sending to the backend for processing since excessively large recordings can cause performance issues and may not be processed successfully by the backend
                showError('Recording is too large. Please record a shorter session (max 25 MB).');
                setRecording(false);  // Set the recording state back to false to reset the button text and allow for a new recording session since this recording is not valid and we want to give the user a chance to record again without issues
                return;
              };

              if (blob.size < 1000) {  // If the blob size is less than 1000 bytes, we consider that the recording is too short or failed, so we show an error message to the user and return early without sending to the backend for processing since there is likely no usable audio in that recording
                showError('Recording too short. Please record at least 1 second of audio.');
                setRecording(false);  // Set the recording state back to false to reset the button text and allow for a new recording session since this recording is not valid and we want to give the user a chance to record again without issues
                return;
              }

              // Otherwise the recording was successful and we send the audio blob to the whispr API backend to be converted to text
              sendToWhisper(blob);
              if (!user?.clinician_id) return;
              await handleAudit({
                actorId: user?.clinician_id,
                actorEmail: user?.email,
                actionType: 'MUTATE_RECORD',
                patientId: session?.patient_id,
                description: `User ended recording on session with ID: ${sessionId}`
              });
              setRecording(false);  // Set the recording state back to false to reset the button text and allow for a new recording session after the current recording has been processed and sent to the backend for transcription
            } catch (err) {
              console.error('Error processing recording:', err);
              showError('An error occurred while processing the recording. Please try again.');
              setRecording(false);  // Set the recording state back to false to reset the button text and allow the user to try recording again
              try {
                await handleDebug('transcription', 'Error processing recording', getErrorDescription(err))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to processing the recording, which is critical for the transcription functionality of this page. By sending the error details to our backend, we can analyze patterns, identify common issues, and improve the overall reliability of our audio recording and transcription process.
              } catch (debugError) {
                console.error('Error sending debug info:', debugError);
              };
              return;
            }
          };
        };
      };
    } catch (error) {  // Catch any error that occurs during the recording process and log it for debugging, and show a user-friendly error message
      console.error('Error during recording:', error);
      showError('An error occurred while trying to record audio. Please try again.');
      try {
        await handleDebug('transcription', 'Failed to record audio', getErrorDescription(error))  // Send the error to the backend for debugging using the reusable function | This will help us track and debug any issues related to recording audio, which is critical for the transcription functionality of this page. By sending the error details to our backend, we can analyze patterns, identify common issues, and improve the overall reliability of our audio recording and transcription process.
      } catch (debugError) {
        console.error('Error sending debug info:', debugError);
      }
      setRecording(false);  // Set the recording state back to false to reset the button text and allow the user to try recording again
      return;
    }
  };

  const sendToWhisper = async (blob: Blob) => {  // Function to send the recorded audio blob to the Whisper API for transcription
    setTranscribeLoad(true);  // Set the loading state for the transcription process to true to disable the record button and show a loading indicator if desired while the transcription is being processed
    setTranscript('');  // Clear the transcript state to remove any previous transcript from the page while the new transcription is being processed, which can help avoid confusion for the user and provide a clear indication that a new transcription is in progress

    try {
      const formData = new FormData();  // Create a new FormData object to send the audio file in a multipart/form-data request to the backend | basically get everything together to send to the backend
      formData.append('file', blob, 'audio.webm');  // Add the audio blob to the FormData object with the key 'file' and a filename of 'audio.webm' | This is what the backend expects to receive and process the audio file
      formData.append('model', 'whisper-1');  // Specify the model being used for transcription

      const start = Date.now()
      const response = await fetch(apiUrl('/transcribe'), {  // Make the call to the API route and send the formData in the body
        method: 'POST',
        body: formData
      });

      const duration = Date.now() - start;  // Calculate the time it took to transcribe
      await handlePerformance('transcribe', duration);  // Send to backend using function

      if (response.ok) {  // If the response is ok, parse the response to get the transcript text and set it to the transcript constant
        const data = await response.json()
        showSuccess('Transcription successful! Ready to submit');  // Show success message that transcription is complete
        setTranscript(data.text || 'No transcript found.');
      } else {  // Otherwise, if the response is not ok, log the error and show an error message to the user
        const error = await response.json();
        console.error('Transcription failed', error);
        showError('Transcription failed, please try again.');
        setTranscript('');
        await handleDebug('transcription', 'Failed to transcribe audio', getErrorDescription(error))
        return;
      }
    } catch (err) {  // Catch any error that occurs during the transcription process and log it for debugging, and show a user-friendly error message
      console.error('Error during transcription:', err);
      showError('An error occurred while trying to transcribe audio. Please try again.');
      setTranscript('');
      await handleDebug('transcription', 'Error during transcription', getErrorDescription(err))
      return;
    } finally {
      setTranscribeLoad(false);  // Set the loading state for the transcription process to false to re-enable the record button and hide the loading indicator if it was shown
    }
  };

  const sendToModel = async () => {  // Function to send the transcript to the AI model for processing and to get the AI output, which will then be displayed on the page and saved to the database
    if (selectedAITemplates.length === 0) {  // If no AI templates selected => display error message and return early
      showError('You must have select at least one template to run the AI.')
      return;
    }

    if (!transcript.trim() || !transcript) {  // If no transcript, show an error message and return early since we need the transcript to send to the model
      showError('You must have a transcript to run the AI.')
      return;
    };

    setAILoad(true);  // Set the loading state for the AI generation process to true to disable the record button and show the loading indicator

    try {
      const token = user?.access_token

      const start = Date.now()  // Start a timer to track how long the AI generation process takes, which can be useful for performance monitoring and debugging
      const response = await fetch(apiUrl('/chat'), {  // Make the POST request to our API route that interacts with the OpenAI API, sending the transcript as the body of the request
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ structure })  // Send the structured input in the request body as JSON
      });

      const duration = Date.now() - start;  // Calculate the time it took to get the AI response
      await handlePerformance('ai_generation', duration);  // Send the performance data to the backend using the helper function

      if (response.ok) {  // If the response is ok, parse the response to get the AI output, display it on the page, and save it to the database
        posthog.capture('pro ai generated note')
        const data = await response.json();   // Collect the response data from the API
        const output = data.choices?.[0]?.message?.content || data.text || '';  // Extract the AI output from the response data, checking for both chat and completion response formats, and set to nothing if nothing was generated
        if (!user?.clinician_id) return;
        await handleAudit({
          actorId: user?.clinician_id,
          actorEmail: user?.email,
          actionType: 'RUN_AI',
          patientId: session?.patient_id,
          description: `User used Ombros-L on session with ID: ${sessionId}`
        });
        await formatAIOutput(output)  // Call the output clean up function and pass the raw output from the model as the parameter | This is good practice so that there is no delay or lag in the info being passed and used in the function
      } else {  // Otherwise, if the response is not ok, log the error and show an error message to the user
        const error = await response.json();
        console.error('AI generation failed', error);
        showError('AI generation failed, please try again.');
        await handleDebug('ai', 'Failed to generate AI output', getErrorDescription(error))
        return;
      }
      return;
    } catch (err) {
      await handleDebug('ai', 'Failed to generate AI output', getErrorDescription(err))
      return;
    } finally {
      setAILoad(false);  // Set the loading state for the AI generation process to false to re-enable the record button and hide the loading indicator
    }
  };

  const formatAIOutput = async (input: string) => {  // Function to clean up the AI output
    try {
      if (!input || input.trim() === '') {  // Takes in the input and checks that there is something (not empty)
        setAIOutput('No clinical output generated');  // Otherwise set the default fallback value
        return;
      }

      let output = input.trim();  // Set a temporary constant to the raw output trimmed

      // Normalize line breaks
      output = output.replace(/\r\n/g, '\n');

      // Remove excess spacing
      output = output.replace(/\n{3,}/g, '\n\n');

      // Ensure consistent spacing after labels in SOAP
      output = output.replace(/S:\s*/g, "S: ");
      output = output.replace(/O:\s*/g, "O: ");
      output = output.replace(/A:\s*/g, "A: ");
      output = output.replace(/P:\s*/g, "P: ");

      setAIOutput(output);  // Set the AI output to the refined output


      const response = await fetch(apiUrl('/sessions/saveOutput'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ output, sessionId })
      });

      const results = await response.json();  // Parse the JSON response from the

      if (results.error || !results.success) {
        console.error('Failed to save AI output to database.')
        return;
      }

      return;
    } catch (err) {
      console.error('Error formatting AI output:', err);
      showError('An error occurred while processing the AI output. Please try again.');
      return;
    }
  };

  const updateConsent = async (consent: boolean) => {  // Function to update the consent value in the database when the user clicks the consent button, which will then update the session state to reflect the change | This is important for ensuring that we have proper consent from the client for using their data and for compliance with privacy regulations. By updating the consent value in the database and reflecting it in the session state, we can ensure that we are respecting the client's preferences and maintaining transparency about data usage.
    setError('');  // Clear previous errors
    setConsentLoad(true);  // Set the loading state for the consent update process to true to disable the consent button and show a loading indicator if desired while the update is being processed

    try {
      const response = await fetch(apiUrl('/sessions/updateConsent'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ consent, sessionId })
      });

      const results = await response.json();  // Parse the JSON response from the

      if (results.error || !results.success) {
        console.error('Failed to consent in database.')
        return;
      }

      setSession((prev) => prev ? { ...prev, consent } : prev);  // Update the session state with the new consent value to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User updated consent on session with ID: ${sessionId}`
      });

      return;
    } catch (err) {
      console.error('Unexpected error updating consent', err);
      showError('Failed to update consent, please try again.');
      return;
    } finally {
      setConsentLoad(false);  // Set the loading state for the consent update process back to false to re-enable the consent button and hide the loading indicator if it was shown
    };
  };

  const newSessionNoteArray = async (key: string) => {  // Function to start a new session, which will redirect the user to the pre-session page where they can input the pre-session information for the new session | This is important for allowing the user to easily start a new session after completing one, and for ensuring that they can input the necessary pre-session information for the new session to get the best experience and results from the AI generation
    setError('');  // Clear previous errors
    setPrevLoad(true);  // Set the loading state for the previous sessions update process to true to disable the previous sessions button and show a loading indicator if desired while the update is being processed
    const newSessionArray = { key: key, text: '' };  // Create a new session object with the key and an empty text value to be added to the previous sessions array in the database, which will allow us to keep track of the previous sessions for the pro and provide context for the AI in future sessions, while only keeping the last 5 sessions to avoid having too much data and to ensure that the most relevant and recent sessions are included in the context
    const newPrevSessionArrayForClient = [...prevSessionsUser, newSessionArray];  // We also create a new previous sessions array for the client to keep track of the previous sessions from the client's perspective, which can be used to provide context in the UI or for other purposes

    try {
      const response = await newSessionNote(key, prevSessionsPro, sessionId)  // Call the reusable function to create the new session in the database and pass the necessary parameters, which will return the updated previous sessions array after the new session is created in the database, allowing us to keep the state consistent with the database and reflect the change in the UI immediately after the creation is successful
      setPrevSessionsPro(response.data);  // Update the session state with the new previous sessions value to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database

      if (session?.patient_id && session?.entry_id) {  // Ensure both patient_id and entry_id are defined before calling updatePrevSessions | This is to add for a connected client (this is the ecosystem advantage)
        await updatePrevSessions(session.patient_id, session.entry_id, newPrevSessionArrayForClient)  // Call the reusable function to update the previous sessions for the client as well, which will ensure that both the pro and the client have their previous sessions updated in the database and reflected in their respective states, allowing for consistent tracking of session history and providing relevant context for future sessions from both perspectives
        setPrevSessionsUser(newPrevSessionArrayForClient);  // Update the session state with the new previous sessions value for the client to reflect the change in the UI, ensuring that the client's previous sessions are also updated and consistent with the database, which can be important for providing context in the UI or for other purposes related to the client's session history
      };
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User added new session notes array with key: ${key} and in session with ID: ${sessionId}`
      });

      return;
    } catch (err) {
      console.error('Unexpected error creating new session', err);
      showError('Failed to create new session, please try again.');
      return;
    } finally {
      setPrevLoad(false);  // Set the loading state for the previous sessions update process back to false to re-enable the new session button
    };
  };  // Adapt to a Promise.all for both for speed and smoothness

  const updateSessionNoteArray = async (key: string) => {  // Function to update a session note based on the session key, which will update the corresponding session note in the previous sessions array in the database and update the session state to reflect the change in the UI | This is important for allowing the user to keep their session notes up to date and accurate, which can provide better context for the AI in future sessions and can also help the user keep track of their session history and notes effectively
    setError('');  // Clear previous errors

    try {
      const response = await updateSessionNote(key, sessionNote, sessionId, prevSessionsPro)  // Call the reusable function to update the session note in the database and pass the necessary parameters, which will return the updated previous sessions array after the update is made in the database, allowing us to keep the state consistent with the database and reflect the change in the UI immediately after the update is successful
      setPrevSessionsPro(response.data);  // Update the session state with the new previous sessions value to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User updated sessions array with key: ${key} and in session with ID: ${sessionId}`
      });
      return;
    } catch (err) {
      console.error('Unexpected error updating previous sessions', err);
      showError('Failed to update previous sessions, please try again.');
      return;
    };
  };  // Adapt to a Promise.all for both for speed and smoothness

  const deleteAssignmentArray = async (key: string) => {  // Function to delete an assignment based on the session key, which will remove the corresponding session object from the assignments array in the database and update the session state to reflect the change in the UI | This is important for allowing the user to manage their assignments effectively and keep their session information up to date, which can provide better context for the AI in future sessions and can also help the user keep track of their assignments and session history effectively
    setError('');  // Clear previous errors
    setPrevLoad(true);  // Set the loading state for the previous sessions update process to true to disable the previous sessions button and show a loading indicator if desired while the update is being processed

    try {
      const response = await deleteAssignment(key, clientAssignments, sessionId)  // Call the reusable function to delete the assignment from the database and pass the necessary parameters, which will return the updated assignments array after the deletion is made in the database, allowing us to keep the state consistent with the database and reflect the change in the UI immediately after the deletion is successful
      setClientAssignments(response.data);  // Update the assignments state with the new complete array to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User deleted assignment on assignment with ID: ${key} and session with ID: ${sessionId}`
      });
      return;
    } catch (err) {
      console.error('Unexpected error deleting assignment', err);
      showError('Failed to delete assignment, please try again.');
      return;
    } finally {
      setPrevLoad(false);  // Set the loading state for the previous sessions update process back to false to re-enable the new session button
    }
  };  // Adapt to a Promise.all for both for speed and smoothness

  const createNewAssignmentArray = async (key: string) => {  // Function to create a new empty assignment
    setError('');  // Clear previous errors
    setPrevLoad(true);  // Loading state for disabling

    try {
      const response = await createNewAssignment(key, clientAssignments, sessionId)  // Call the reusable function to create the new assignment in the database and pass the necessary parameters, which will return the updated assignments array after the new assignment is created in the database, allowing us to keep the state consistent with the database and reflect the change in the UI immediately after the creation is successful
      setClientAssignments(response.data);  // Update the assignments state with the new complete array to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User created new assignment on assignment with ID: ${key} and session with ID: ${sessionId}`
      });
      return;
    } catch (err) {
      console.error('Unexpected error creating new assignment', err);
      showError('Failed to create new assignment, please try again.');
      return;
    } finally {
      setPrevLoad(false);  // Set the loading state for the previous sessions update process back to false to re-enable the new session button
    };
  };  // Adapt to a Promise.all for both for speed and smoothness

  const updateAssignmentArray = async (key: string) => {  // Function to update a session note based on the session key, which will update the corresponding session note in the previous sessions array in the database and update the session state to reflect the change in the UI | This is important for allowing the user to keep their session notes up to date and accurate, which can provide better context for the AI in future sessions and can also help the user keep track of their session history and notes effectively
    setError('');  // Clear previous errors
    if (!selectedAssignment || selectedAssignment.length === 0) {  // Verifies that the assignment is selected
      showError('No assignment selected');
      return;
    };

    if (selectedAssignment[0].times !== null && selectedAssignment[0].times < 1 || selectedAssignment[0].reps !== null && selectedAssignment[0].reps < 1 || selectedAssignment[0].weeks !== null && selectedAssignment[0].weeks < 1 || selectedAssignment[0].hours !== null && selectedAssignment[0].hours < 1) {  // If the assignment is empty, show an error message and return early since we don't want to create or update empty assignments in the database
      showError('You cannot have values less than 1 for times, reps, weeks, or hours. Please enter valid values or leave them empty if not applicable.');
      return;
    }

    try {
      const response = await updateAssignment(key, selectedAssignment, clientAssignments, sessionId)  // Call the reusable function to update the assignment in the database and pass the necessary parameters, which will return the updated assignments array after the update is made in the database, allowing us to keep the state consistent with the database and reflect the change in the UI immediately after the update is successful
      setClientAssignments(response.data);  // Update the assignments state with the new complete array to reflect the change in the UI, ensuring that the user's action is immediately visible and that the state is consistent with the database
      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User updated assignment on assignment with ID: ${selectedAssignment[0].key} and session with ID: ${sessionId}`
      });
      return;
    } catch (err) {
      console.error('Unexpected error updating assignment', err);
      showError('Failed to update assignment, please try again.');
      return;
    };
  };  // Adapt to a Promise.all for both for speed and smoothness

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {  // Function to handle file input change event, which will upload the selected file to Supabase storage and update the session state with the file URL, allowing the user to easily upload and manage files related to their session, which can provide better context for the AI and enhance the overall session experience
    setError('');  // Clear previous errors
    const file = e.target.files?.[0];  // Get the selected file from the input event
    setPrevLoad(true);  // Set the loading state for the previous sessions update process to true to disable the previous sessions button and show a loading indicator if desired while the update is being processed

    try {
      if (!selectedAssignment || selectedAssignment.length === 0) {  // Verifies that the assignment is selected
        showError('No assignment selected');
        return;
      }

      if (!file) {  // If no file is selected, return early since there is nothing to upload
        showError('No file selected. Please choose a file to upload.');
        return;
      }

      const fileName = `assignments/${file.name}-${Date.now()}`  // For ease of use

      // Upload to Supabase Storage
      const { error } = await supabase.storage
        .from('assignments')  // Bucket name
        // We set the name and the file associated with it
        .upload(fileName, file, {
          contentType: file.type,
          upsert: true,
          headers: {
            'authentication': `Bearer ${token}`
          }
        });  // The path where the file will be stored in the bucket, using the original file name, and allowing upsert to overwrite if a file with the same name already exists
      if (error) {
        showError('Failed to upload file');
        console.error('Error uploading file:', error);
        return;
      }

      if (!user?.clinician_id) return;
      await handleAudit({
        actorId: user?.clinician_id,
        actorEmail: user?.email,
        actionType: 'MUTATE_RECORD',
        patientId: session?.patient_id,
        description: `User added file to assignment on assignment with ID: ${selectedAssignment[0].key} and session with ID: ${sessionId}`
      });
      setSelectedAssignment([{ ...selectedAssignment[0], fileUrl: fileName }]);  // Set the url to the selected assignment
    } catch (err) {
      console.error('Error uploading file:', err);
      showError('An error occurred while uploading the file. Please try again.');
      return;
    } finally {
      setPrevLoad(false);  // Set the loading state for the previous sessions update process back to false to re-enable the previous sessions button
    }
  };

  return (
    // Setting the HTML structure of the home page
    <ClientLayout>
      <main className={styles.main}>
        <div className={styles.mainSplit}>
          <div className={styles.contentSpacer}>
            {sessionView === 'data' ? (
              <div className={sessionStyles.mainRow}>
                <div className={sessionStyles.aiColumn}>
                  <input
                    type='text'
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className={sessionStyles.clientNameInput}
                    placeholder="Input client's full name"
                    onKeyDown={e => {
                      if (e.key === 'Enter') changeName();
                    }}
                    onBlur={() => changeName()}
                  />
                  <div className={sessionStyles.pdfBox}>
                    {voteBox ? (
                      <div ref={voteBoxRef} className={sessionStyles.voteBox}>
                        <div className={sessionStyles.voteBoxTemplates}>
                          {voteTemplates.map((template) => (  // Map through the vote templates to display them as buttons in the vote box
                            <button
                              key={template}
                              className={`${sessionStyles.voteTemplateButton} ${selectedTemplate.includes(template) ? sessionStyles.selectedTemplate : ''}`}
                              onClick={() => {
                                setSelectedTemplate((prev) =>
                                  prev.includes(template)  // If the template is already selected, remove it from the selected templates, otherwise add it to the selected templates
                                    ? prev.filter(t => t !== template)
                                    : [...prev, template]
                                );
                              }}
                              type="button"
                            >
                              {template}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className={sessionStyles.voteBoxInput}
                          value={voteFeedback}
                          onChange={(e) => setVoteFeedback(e.target.value)}
                          placeholder="Any specific feedback for us to improve or to elaborate on your selections? (optional)"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitFeedback();  // Need the parenthesis here since is a UX convenience (run function while in keyboard)
                          }}
                        />
                        <button className={sessionStyles.voteBoxSubmitButton} onClick={submitFeedback} disabled={!voteFeedback || feedbackLoad}>Submit Feedback</button>
                      </div>
                    ) : (
                      session?.mode === 'concussion' ? (
                        <>
                          <div className={sessionStyles.pdfContainer}>
                            <div className={sessionStyles.concussionColumn}>
                              <div className={sessionStyles.concussionHeader}>
                                <p className={sessionStyles.concussionPast}>Previous Concussion:</p>
                                <p className={sessionStyles.concussionPastResults}>{session?.user_inputs?.concussion_info?.pastConcussion === true ? 'True' : 'False'}</p>
                              </div>
                              {session?.user_inputs?.concussion_info?.pastConcussion === true && (
                                <>
                                  <p className={sessionStyles.concussionDetailsHeader}>Concussion Details:</p>
                                  <div className={sessionStyles.concussionDetails}>
                                    <p className={sessionStyles.pastConcussionDetailLabel}>{session?.user_inputs?.concussion_info?.prevConcussions?.title}</p>
                                    <p className={sessionStyles.pastConcussionDetailLabel}>{session?.user_inputs?.concussion_info?.prevConcussions?.occurrences} Occurrences</p>
                                    <p className={sessionStyles.pastConcussionDetailLabel}> Recently: {session?.user_inputs?.concussion_info?.prevConcussions?.recent_year}</p>
                                  </div>
                                </>
                              )}
                              <p className={sessionStyles.concussionSymptoms}>Reported Symptoms:</p>
                              <ul className={sessionStyles.concussionSymptomsList}>
                                {session?.user_inputs?.concussion_info?.symptoms?.map((symptom: string, index: number) => (
                                  <li key={index} className={sessionStyles.concussionSymptomItem}>{symptom}</li>
                                ))}
                              </ul>
                              <p className={sessionStyles.testResults}>Saliva Test Results: {session?.user_inputs?.concussion_info?.results === 'noTest' ? 'Did not take a test' : session?.user_inputs?.concussion_info?.results.toUpperCase()}</p>
                            </div>
                            <div className={sessionStyles.votingRow}>
                              <Image src={vote === 'good' ? '/thumbsUpActive.png' : '/thumbsUp.png'} alt='Upvote' width={24} height={24} className={sessionStyles.voteIcon} onClick={vote === 'good' ? () => handleVote(null) : () => { handleVote('good'); setVoteBox(true); }} />
                              <Image src={vote === 'bad' ? '/thumbsDownActive.png' : '/thumbsDown.png'} alt='Downvote' width={24} height={24} className={sessionStyles.voteIcon} onClick={vote === 'bad' ? () => handleVote(null) : () => { handleVote('bad'); setVoteBox(true); }} />
                            </div>
                          </div>
                        </>
                      ) : (
                        session && session.pdf ? (
                          <>
                            <div className={sessionStyles.pdfContainer}>
                              <iframe
                                ref={pdfRef}
                                src={`data:application/pdf;base64,${session.pdf}`}
                                className={sessionStyles.sessionPDF}
                                title="PDF Preview"
                              />
                              <div className={sessionStyles.fullScreenRow}>
                                <Image src='/fullScreen.png' alt='Full Screen' width={24} height={24} className={sessionStyles.fullScreenIcon} onClick={handleFullScreen} />
                                <div className={sessionStyles.votingRow}>
                                  <Image src={vote === 'good' ? '/thumbsUpActive.png' : '/thumbsUp.png'} alt='Upvote' width={24} height={24} className={sessionStyles.voteIcon} onClick={vote === 'good' ? () => handleVote(null) : () => { handleVote('good'); setVoteBox(true); }} />
                                  <Image src={vote === 'bad' ? '/thumbsDownActive.png' : '/thumbsDown.png'} alt='Downvote' width={24} height={24} className={sessionStyles.voteIcon} onClick={vote === 'bad' ? () => handleVote(null) : () => { handleVote('bad'); setVoteBox(true); }} />
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <p>No PDF available</p>
                        )
                      ))}
                  </div>
                  <div className={sessionStyles.clinicianInfo}>
                    <p className={sessionStyles.clinicianName}>{fullName}</p>
                    <p className={sessionStyles.clinicName}>{clinicName}</p>
                    <button className={sessionStyles.homeButton}>
                      <Link href={'/'} className={sessionStyles.homeButtonText}>
                        ⟵ Home
                      </Link>
                    </button>
                  </div>
                </div>
                <div className={sessionStyles.pdfColumn}>
                  <div className={sessionStyles.soapColumn}>
                    <div className={sessionStyles.letterRow}>
                      <Image src="/sSOAP.png" alt="S" width={24} height={24} className={sessionStyles.letterIcon} />
                      {(() => {
                        const subjectiveItems = (soapInfo?.subjective || '').split(/\s*•\s*/).map(line => line.trim()).filter(Boolean);  // Will split at each bullet point and then map each line and filter out any empty lines to create an array of subjective items, which will allow us to display each subjective item as a separate bullet point in the UI, providing better readability and organization for the subjective section of the SOAP note
                        return subjectiveItems.length > 0 ? (  // Only display each point if subjectiveItems in non-empty
                          <ul className={sessionStyles.letterText}>
                            {subjectiveItems.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (  // Otherwise display the default text
                          <p className={sessionStyles.letterText}>No Subjective Available</p>
                        );
                      })()}
                    </div>
                    <div className={sessionStyles.letterRow}>
                      <Image src="/oSOAP.png" alt="O" width={24} height={24} className={sessionStyles.letterIcon} />
                      {(() => {
                        const objectiveItems = (soapInfo?.objective || '').split(/\s*•\s*/).map(line => line.trim()).filter(Boolean);  // Will split at each bullet point and then map each line and filter out any empty lines to create an array of objective items, which will allow us to display each objective item as a separate bullet point in the UI, providing better readability and organization for the objective section of the SOAP note
                        return objectiveItems.length > 0 ? (  // Only display each point if objectiveItems in non-empty
                          <ul className={sessionStyles.letterText}>
                            {objectiveItems.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (  // Otherwise display the default text
                          <p className={sessionStyles.letterText}>No Objective Available</p>
                        );
                      })()}
                    </div>
                    <div className={sessionStyles.letterRow}>
                      <Image src="/aSOAP.png" alt="A" width={24} height={24} className={sessionStyles.letterIcon} />
                      {(() => {
                        const assessmentItems = (soapInfo?.assessment || '').split(/\s*•\s*/).map(line => line.trim()).filter(Boolean);  // Will split at each bullet point and then map each line and filter out any empty lines to create an array of assessment items, which will allow us to display each assessment item as a separate bullet point in the UI, providing better readability and organization for the assessment section of the SOAP note
                        return assessmentItems.length > 0 ? (  // Only display each point if assessmentItems in non-empty
                          <ul className={sessionStyles.letterText}>
                            {assessmentItems.map((line, index) => (  // Maps deach one based on its index in the array to create a unique key for each list item
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (  // Otherwise display the default text
                          <p className={sessionStyles.letterText}>No Assessment Available</p>
                        );
                      })()}
                    </div>
                    <div className={sessionStyles.letterRow}>
                      <Image src="/pSOAP.png" alt="P" width={24} height={24} className={sessionStyles.letterIcon} />
                      {(() => {
                        const planItems = (soapInfo?.plan || '').split(/\s*•\s*/).map(line => line.trim()).filter(Boolean);  // Will split at each bullet point and then map each line and filter out any empty lines to create an array of plan items, which will allow us to display each plan item as a separate bullet point in the UI, providing better readability and organization for the plan section of the SOAP note
                        return planItems.length > 0 ? (  // Only display each point if planItems in non-empty
                          <ul className={sessionStyles.letterText}>
                            {planItems.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        ) : (  // Otherwise display the default text
                          <p className={sessionStyles.letterText}>No Plan Available</p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                <div className={sessionStyles.recordColumn}>
                  <p className={sessionStyles.clientAssignmentsTitle}>Client Assignments</p>
                  <div className={sessionStyles.clientAssignments}>
                    {session?.entry_id && session?.patient_id ? (
                      <>
                        <div className={sessionStyles.assignmentsColumnDisplay}>
                          {clientAssignments.length > 0 ? (
                            clientAssignments.map((item) => {
                              return (
                                <div
                                  key={item.key}
                                  className={sessionStyles.clientAssignment}
                                  onClick={() => setSelectedAssignment([item])}
                                >
                                  <p className={sessionStyles.clientAssignmentTitle}>{item.title}</p>
                                  <button
                                    className={sessionStyles.deleteAssignmentButton}
                                    disabled={prevLoad}
                                    onClick={(e) => {
                                      if (confirm('Are you sure you want to delete this assignment?')) {
                                        e.stopPropagation();
                                        deleteAssignmentArray(item.key);
                                      }
                                    }}
                                  >
                                    <Image src="/delete.png" alt="Delete" width={16} height={16} className={sessionStyles.deleteIcon} />
                                  </button>
                                </div>
                              );
                            })
                          ) : (
                            <p className={sessionStyles.noPrevSessions}>No assignments created.</p>
                          )}
                        </div>

                        {(() => {
                          const randomKey = globalThis.crypto.randomUUID();
                          return (
                            <button
                              className={sessionStyles.newAssignmentButton}
                              onClick={() => createNewAssignmentArray(randomKey)}
                              disabled={prevLoad}
                            >
                              <Image src="/plus.png" alt="Add Session" width={16} height={16} className={sessionStyles.plusIcon} />
                            </button>
                          );
                        })()}
                      </>
                    ) : (
                      <p className={sessionStyles.missingPersonText}>No user assigned to this session</p>
                    )}
                  </div>
                </div>
              </div>
            ) : sessionView === 'ai' ? (
              <div className={sessionStyles.mainRow}>
                <div className={sessionStyles.aiColumn}>
                  <div className={sessionStyles.aiBox}>
                    <p className={sessionStyles.aiOutput}>{aiOutput ? aiOutput : "No AI Generated Output"}</p>
                    <div className={sessionStyles.aiModelRow}>
                      <Image src={theme === 'light' ? "/clipboardDark.png" : "/clipboardLight.png"} alt="Clipboard" width={24} height={24} className={sessionStyles.clipboardIcon} onClick={handleCopyToClipboard} />
                      <p className={sessionStyles.aiModelLabel}>Ombros-L1</p>
                    </div>
                  </div>
                </div>
                <div className={sessionStyles.pdfColumn}>
                  <textarea
                    className={sessionStyles.sensitiveScriptInput}
                    value={sensitiveScript}
                    onChange={(e) => setSensitiveScript(e.target.value)}
                    placeholder="Sensitive script for the AI to consider in the output (optional) | Anything you don't wish to say aloud but want the AI to consider in its output can go here"
                  />
                  <button disabled={recording || aiLoad || consentLoad || !userConsent} className={recording || aiLoad ? sessionStyles.AIButtonDisabled : sessionStyles.AIButton} onClick={() => { if (aiOutput) { if (confirm('Are you sure you want to run the AI model? This would overwrite your current AI output.')) { sendToModel } } else { sendToModel } }}>
                    Submit
                  </button>
                  {/* Display the error message if there is an error at the top of the table or the success message */}
                  {error && (
                    <div className={styles.error} onClick={() => setError('')}>
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className={styles.success} onClick={() => setSuccess('')}>
                      {success}
                    </div>
                  )}
                  <div className={sessionStyles.clinicianInfo}>
                    <p className={sessionStyles.clinicianName}>{fullName}</p>
                    <p className={sessionStyles.clinicName}>{clinicName}</p>
                    <button className={sessionStyles.homeButton}>
                      <Link href={'/'} className={sessionStyles.homeButtonText}>
                        ⟵ Home
                      </Link>
                    </button>
                  </div>
                </div>
                <div className={sessionStyles.recordColumn}>
                  <button
                    className={recording ? sessionStyles.recordButtonActive : sessionStyles.recordButton}
                    onClick={() => {
                      if (transcript) {
                        if (confirm('Are you sure you want to record? This would overwrite your current transcript.')) {
                          setRecording(!recording);
                          handleRecordClick();
                        }
                      } else {
                        setRecording(!recording);
                        handleRecordClick();
                      }
                    }}
                    disabled={transcribeLoad || consentLoad || !userConsent}  // Disable the record button while the transcription is being processed to prevent multiple recordings at the same time and to ensure a smoother user experience
                  >
                    <Image src="/micDarkMode.png" alt="Record" width={24} height={24} className={sessionStyles.micIcon} />
                  </button>
                  <div className={sessionStyles.consentRow}>
                    <p className={sessionStyles.consentLabel}>Client Consent:</p>
                    <button
                      className={sessionStyles.consentButton}
                      onClick={() => {
                        if (userConsent === true) {
                          if (confirm('Are you sure you want to remove the user\'s recording consent?')) {
                            updateConsent(!userConsent);
                            setUserConsent(!userConsent);
                          }
                        } else {
                          setUserConsent(!userConsent);
                          updateConsent(!userConsent);
                        }
                      }}
                      disabled={consentLoad || recording}  // Disable the consent button while the consent update is being processed to prevent multiple updates at the same time and to ensure a smoother user experience
                    >
                      <Image src={userConsent ? "/checkBox.png" : "/emptyCheck.png"} alt="Consent" width={24} height={24} className={sessionStyles.consentIcon} />
                    </button>
                  </div>
                  <div className={sessionStyles.templateBox}>
                    {aiTemplates.map((template) => (  // Map through the AI templates to display them as buttons in the template box
                      <button
                        key={template}
                        className={`${sessionStyles.aiTemplateButton} ${selectedAITemplates.includes(template) ? sessionStyles.selectedAITemplate : ''}`}
                        onClick={() => {
                          setSelectedAITemplates((prev) =>
                            prev.includes(template)  // If the template is already selected, remove it from the selected templates, otherwise add it to the selected templates
                              ? prev.filter(t => t !== template)
                              : [...prev, template]
                          );
                        }}
                        type="button"
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : sessionView === 'closeLoop' ? (
              <div className={sessionStyles.mainRow}>
                <div className={sessionStyles.prevSessionsBox}>
                  {session?.entry_id && session?.patient_id ? (
                    <>
                      <div className={sessionStyles.prevSessionsHeader}>
                        <p className={sessionStyles.prevSessionsTitle}>Continued Sessions</p>
                      </div>
                      <div className={sessionStyles.prevSessionsSplit}>
                        <div className={sessionStyles.prevSessionsListSplit}>
                          <div className={sessionStyles.prevSessionsList}>
                            {prevSessionsPro.length > 0 ? (
                              prevSessionsPro.map((item, index) => {
                                const sessionNumber = index + 2;
                                return (
                                  <div key={item.key} className={selectedPrevSession && selectedPrevSession[0]?.key === item.key ? sessionStyles.selectedPrevSessionButton : sessionStyles.prevSessionsActivateButton} onClick={() => [setSelectedPrevSession([item]), setSessionNote(item.text)]}>
                                    <p className={sessionStyles.prevSessionsActivateTitle}>Session {sessionNumber}</p>
                                  </div>
                                );
                              })
                            ) : (
                              <p className={sessionStyles.noPrevSessions}>No extra sessions found.</p>
                            )}
                          </div>
                          {(() => {
                            const nextSessionNumber = prevSessionsPro.length + 2;  // Takes the sessions length and adds one to create a new session
                            return (
                              <button className={sessionStyles.prevSessionButton} onClick={() => (newSessionNoteArray(`session${nextSessionNumber}`))} disabled={prevLoad}>
                                <Image src="/plus.png" alt="Add Session" width={16} height={16} className={sessionStyles.plusIcon} />
                              </button>
                            );
                          })()}
                        </div>
                        <div className={sessionStyles.prevSessionsInfoBox}>
                          <div className={sessionStyles.prevSessionsInfoPro}>
                            {selectedPrevSession ? (
                              <textarea className={sessionStyles.prevSessionText} value={sessionNote} onChange={(e) => setSessionNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') updateSessionNoteArray(selectedPrevSession[0].key); }} onBlur={() => updateSessionNoteArray(selectedPrevSession[0].key)} placeholder="Add notes for session" />
                            ) : (null)}
                          </div>
                          <div className={sessionStyles.prevSessionsInfoPatient}>
                            {selectedPrevSession ? (
                              <p className={sessionStyles.prevSessionText}>
                                {/* Match the user sessions key to the selected session and then extract the text */}
                                {prevSessionsUser.filter(prevSession => prevSession.key === selectedPrevSession[0].key)[0]?.text || 'No patient session follow up found.'}
                              </p>
                            ) : (null)}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className={sessionStyles.missingPatientText}>
                      No user assigned to this session, so no previous sessions to display.
                    </p>
                  )}
                </div>
                <div className={sessionStyles.clinicianInfo}>
                  <p className={sessionStyles.clinicianName}>{fullName}</p>
                  <p className={sessionStyles.clinicName}>{clinicName}</p>
                  <button className={sessionStyles.homeButton}>
                    <Link href={'/'} className={sessionStyles.homeButtonText}>
                      ⟵ Home
                    </Link>
                  </button>
                </div>
              </div>
            ) : (null)}
          </div>
          <div className={sessionStyles.sessionViewColumn}>
            <div className={sessionStyles.ropeButton}>
              <span className={sessionStyles.sidebarTooltip}>Main Data</span>
              <button className={sessionView === 'data' ? sessionStyles.sessionOptionActive : sessionStyles.sessionOption} onClick={() => setSessionView('data')} onKeyDown={(e) => { if (e.key === 'ArrowDown') setSessionView('ai'); }} />
            </div>
            <div className={sessionStyles.ropeButton}>
              <span className={sessionStyles.sidebarTooltip}>AI Tools</span>
              <button className={sessionView === 'ai' ? sessionStyles.sessionOptionActive : sessionStyles.sessionOption} onClick={() => setSessionView('ai')} onKeyDown={(e) => { if (e.key === 'ArrowUp') setSessionView('data'); else if (e.key === 'ArrowDown') setSessionView('closeLoop'); }} />
            </div>
            <div className={sessionStyles.ropeButton}>
              <span className={sessionStyles.sidebarTooltip}>Multi-Session</span>
              <button className={sessionView === 'closeLoop' ? sessionStyles.sessionOptionActive : sessionStyles.sessionOption} onClick={() => setSessionView('closeLoop')} onKeyDown={(e) => { if (e.key === 'ArrowUp') setSessionView('ai'); }} />
            </div>
          </div>
        </div>
        {selectedAssignment ? (  // If there is a selected patient, we display the insights section for that patient | Otherwise we display a message prompting the user to select a patient profile to view insights
          <div className={sessionStyles.assignmentCardOverlay} onClick={() => [setSelectedAssignment(null), updateAssignmentArray(selectedAssignment[0].key)]}> {/* This onClick is to close the insights section and update the assignment when we click outside of the card */}
            <div className={sessionStyles.assignmentCard} onClick={(e) => e.stopPropagation()}> {/* This onClick is to prevent the click from propagating to the overlay and closing the insights section when we click inside the card */}
              <>
                <input type='text' value={selectedAssignment[0].title} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], title: e.target.value }])} className={sessionStyles.assignmentTitleInput} placeholder="Assignment Title" />
                {/* Display the error message if there is an error at the top of the table or the success message */}
                {error && (
                  <div className={styles.error} onClick={() => setError('')}>
                    {error}
                  </div>
                )}
                {success && (
                  <div className={styles.success} onClick={() => setSuccess('')}>
                    {success}
                  </div>
                )}
                <div className={sessionStyles.assignmentCardTextColumn}>
                  <textarea value={selectedAssignment[0].description} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], description: e.target.value }])} className={sessionStyles.assignmentDescriptionInput} placeholder="Assignment Description" />
                  <div className={sessionStyles.assignmentCardFileRow}>
                    <input id="assignment-file-upload" type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileChange} className={sessionStyles.fileInputHidden} disabled={prevLoad} />
                    {/* The label is used to style the file input, which is hidden, and clicking on the label will trigger the file input | we connect via ID and wrap the label around the image */}
                    <label htmlFor="assignment-file-upload" className={sessionStyles.fileAttachButton}>
                      <Image src="/paperclip.png" alt="Attach File" width={16} height={16} className={sessionStyles.paperclipIcon} />
                    </label>
                    {selectedAssignment[0].fileUrl && (
                      signedURL && (  // Checks if there is a file URL associated with the selected assignment, and if there is, it displays a link to view the attached file, allowing the user to easily access and review any files that are relevant to the assignment, which can provide better context for the AI and enhance the overall session experience | The link opens in a new tab to allow the user to view the file without losing their place in the session interface
                        <>
                          <a href={signedURL} target="_blank" rel="noopener noreferrer" className={sessionStyles.attachedFileLink}>
                            {signedURL.length > 18 ? signedURL.slice(8, 18) + '...' : signedURL}
                          </a>
                          <Image src="/delete.png" alt="Delete File" width={16} height={16} className={sessionStyles.deleteFileIcon} onClick={() => setSelectedAssignment([{ ...selectedAssignment[0], fileUrl: null }])} />
                        </>
                      ))}
                  </div>
                </div>
                <div className={sessionStyles.assignmentDetailsColumn}>
                  <div className={sessionStyles.assignmentDetailsTitleRow}>
                    <p className={sessionStyles.assignmentDetailsTitle}>Times/Week:</p>
                    <p className={sessionStyles.assignmentDetailsTitle}>Hours/Day:</p>
                    <p className={sessionStyles.assignmentDetailsTitle}>Weeks:</p>
                    <p className={sessionStyles.assignmentDetailsTitle}>Reps:</p>
                  </div>
                  <div className={sessionStyles.assignmentDetailsRow}>
                    {/* What we do is basically split the array and edit the value | This sets it temporary so when we update, it reflects the changes more permanently */}
                    <input type='number' value={selectedAssignment[0].times || ''} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], times: e.target.value ? parseInt(e.target.value) : null }])} className={sessionStyles.assignmentDetailInput} placeholder="Times (e.g., 3)" />
                    <input type='number' value={selectedAssignment[0].hours || ''} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], hours: e.target.value ? parseInt(e.target.value) : null }])} className={sessionStyles.assignmentDetailInput} placeholder="Hours (e.g., 2)" />
                    <input type='number' value={selectedAssignment[0].weeks || ''} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], weeks: e.target.value ? parseInt(e.target.value) : null }])} className={sessionStyles.assignmentDetailInput} placeholder="Weeks (e.g., 4)" />
                    <input type='number' value={selectedAssignment[0].reps || ''} onChange={(e) => setSelectedAssignment([{ ...selectedAssignment[0], reps: e.target.value ? parseInt(e.target.value) : null }])} className={sessionStyles.assignmentDetailInput} placeholder="Reps (e.g., 10)" />
                  </div>
                </div>
                <button className={sessionStyles.saveAssignmentButton} onClick={() => [updateAssignmentArray(selectedAssignment[0].key), setSelectedAssignment(null)]}>Save</button>
              </>
            </div>
          </div>
        ) : (null)}
      </main>
    </ClientLayout>
  );
}