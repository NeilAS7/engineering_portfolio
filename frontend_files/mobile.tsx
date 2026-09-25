// Creating the Entries page - Will take in the title and class and store to database to appropriate user ID
import React, { useState } from "react"; // For building the component
import { View, Text, StyleSheet, Image, TextInput, Pressable, TouchableWithoutFeedback, Keyboard, ScrollView } from "react-native"; // Importing necessary components from React Native
import Layout from "../layout"; // Importing the layout component for consistent page structure
import { Link, useRouter } from "expo-router"; // For navigation between pages
import { supabaseAnon } from '../../api';
import { LinearGradient } from "expo-linear-gradient";  // For gradient backgrounds on buttons
import useProtectedRoute from "@/hooks/useProtectedRoute";  // So that the page is protected | Only authenticated users can access
import { useTheme } from "@/context/ThemeContext";  // For accessing the app theme to tint the navbar
import Loading from "../../components/Loading"; // Importing the Loading component to show a loading screen while data is being fetched
import { Colors } from "@/constants/theme";  // Importing color constants for theming (This gives the dark and light mode colors)
import { usePostHog } from "posthog-react-native";  // For posthog tracking
import getErrorDescription from '@/utils/errorHandling';  // To access the function that handles the error message to extract the string
import { handleDebug, handleAudit } from "@/utils/internalBlocks";  // To use the function that handles the debug data insertion to the ombric data platform | For cleaner code and to avoid repetition of code since we use this in multiple places

export default function NewEntryScreen() {  // The function component for new entries
  const { loading, user } = useProtectedRoute();  // Using the custom hook to protect the route
  const { theme } = useTheme();  // Collecting the theme to tint the navbar
  const styles = themedStyles(theme);
  const [error, setError] = useState('');  // To display errors on the front end

  const posthog = usePostHog();  // For tracking
  const router = useRouter();  // For reroute after creating a new entry successfully
  const [title, setTitle] = useState('');  // For setting the entry title
  const [type, setType] = useState('fitness');  // For setting the entry class - will default to fitness
  const [load, setLoad] = useState(false);  // Loading state for creating a new entry

  // For error and success messages, we set a timer to automatically clear the messages after 5 seconds so that they don't stay on the screen indefinitely and clutter the UI | We also allow the user to click on the message to clear it immediately if they want to
  const showError = (message: string) => {  // Shows error message (takes in the message as a parameter when calling the function)
    setError(message);  // Show error (the message passed in parentheses when calling the function)
    window.setTimeout(() => setError(''), 5000);  // Clear after 5 seconds (5000 milliseconds) | So that the error message does not stay on the screen forever
  };

  if (loading) {
    return <Loading />; // Show the loading screen while fetching user data
  };

  if (!loading && !user) return null;  // If still loading and no user data, return null

  const submitEntry = async () => {
    setError(''); // Clear any existing errors when submission starts
    setLoad(true);  // Set loading state to true when submission starts

    try {
      if (!title) {  // If no entry title provided return error
        showError("Please enter a title for the entry.");
        return;
      }

      const { data: user } = await supabaseAnon.auth.getUser();  // Collect the user info from supabase auth
      if (!user?.user) {  // If no user logged in - alert and return
        showError("You must be logged in to create an entry.");
        return;
      }

      const userId = user.user.id;  // Extracting the user ID from the user object

      const { data, error } = await supabaseAnon.from('entries').insert([  // Inserting the new entry into the entries table
        {
          user_id: userId,  // Setting the user ID for the new entry
          entry_title: title,  // The entry title collected from the input
          class: type,  // The entry class collected from the selection
          created_at: new Date().toISOString()  // Setting the created at date to the current date as ISO string
        },
      ])
        .select() // To return the inserted row
        .single();  // Return a single object, not array | Rather than a list (array) [{data}], just a single object {data} for cleaner (no need to index)

      if (error) {  // If any errors with inserting the new entry
        console.error("Error creating entry:", error);
        showError("Error creating entry. Please try again.");  // Alert the user

        await handleDebug('newEntry', 'Failed to create new entry', getErrorDescription(error));  // Use the reusable function to handle debug data insertion
        return;
      };

      const encodeDate = encodeURIComponent(data.created_at);  // Encode the created at date for safe URL usage | Remove/fill extra spaces/line breaks
      posthog.capture('entry created', { entryId: data.entry_id })
      if (!user?.user?.id) return;
      handleAudit({
        actorId: user?.user?.id,
        actorEmail: user?.user?.email,
        actionType: 'VIEW_RECORD',
        description: `User created a new entry: ${data.entry_id}`
      })
      // Encode the title as well for safe URL usage
      router.replace(`/log?entryId=${data.entry_id}&type=${type}&createdAt=${encodeDate}&title=${encodeURIComponent(title)}`);  // Reroute to the logging page to begin logging symptoms - Send the data in the reroute (entry_id and class type)
    } catch (err) {
      console.error("Unexpected error creating entry:", err);
      showError("An unexpected error occurred. Please try again.");  // Alert the user
      await handleDebug('newEntry', 'Failed to create new entry', getErrorDescription(err));  // Use the reusable function to handle debug data insertion
      return;
    } finally {
      setLoad(false);  // Set loading state to false when submission finishes
    };
  };

  return (
    <Layout>
      {/* Using the Layout component for consistent structure */}
      {/* Main container for New Entries */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.logContainer}>
            <View style={styles.heroCard}>
              {error ? <Text style={styles.error} onPress={() => setError('')}>{error}</Text> : null}
              <Text style={styles.actionText}>
                Entry Setup
              </Text>
              <Text style={styles.title}>
                Create your Next Entry
              </Text>
              <Text style={styles.subtitle}>
                Add a title and start logging your symptoms.
              </Text>
            </View>
            <Text style={styles.entryText}>
              Entry Title:
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Doctor's Appointment"
              placeholderTextColor={Colors[theme].text + '99'}  // Adding some opacity to the placeholder text
              value={title}
              onChangeText={setTitle}
            />
            <Text style={styles.classText}>
              Entry Class:
            </Text>
            <View style={styles.classButtons}>
              <Pressable style={[styles.classButton2, type === 'fitness' ? styles.activeFitness : '']} onPress={() => setType('fitness')}>
                <LinearGradient
                  colors={["#1a6094", "#38b6ff"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.classButton2, type === 'fitness' ? styles.activeFitness : '']}
                >
                  <Image source={require('../../assets/images/fit_icon.png')} style={styles.fitnessIcon} />
                  <Text style={{ color: "aliceblue", fontFamily: "Rubik_400Regular", fontWeight: 'bold' }}>
                    Fitness
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
            <Pressable onPress={submitEntry}>
              <LinearGradient
                colors={["#ff5757", "#8c52ff"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitButton}
              >
                <Text style={styles.submitButtonText}>
                  {load ? "Creating Entry" : "+ Create Entry"}
                </Text>
              </LinearGradient>
            </Pressable>
            <View style={styles.entryLink}>
              <Link href="/entries" asChild>
                <Pressable hitSlop={10}>
                  <Text style={styles.viewText}>
                    View all your entries
                  </Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </Layout>
  );
}

// Styles for the New Entry page components - basically the CSS for the page
const themedStyles = (theme: 'light' | 'dark') => StyleSheet.create({  // This allows the theme to access the colorings in the theme.ts file and adjust the colors based on the theme present
  container: {
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 10,
    width: "100%",
  },
  logContainer: {
    width: "100%",
    backgroundColor: Colors[theme].background,
    padding: 20,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors[theme].divider,
    shadowColor: "#170430",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 32,
  },
  heroCard: {
    borderRadius: 20,
    padding: 5,
    backgroundColor: 'transparent',
    shadowColor: "#170430",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    marginBottom: 12,
    borderBottomColor: Colors[theme].divider,
    borderBottomWidth: 1,
    width: "100%",
  },
  actionText: {
    color: theme === 'light' ? '#5c1ef5' : '#31edae',
    fontSize: 15,
    letterSpacing: 0.07,
    textTransform: "uppercase",
    fontFamily: "Rubik_400Regular",
    fontWeight: "600",
    marginBottom: 4,
  },
  title: {
    color: Colors[theme].text,
    fontSize: 32,
    fontFamily: "Rubik_400Regular",
    fontWeight: 'bold',
    marginTop: 6,
    marginBottom: 0,
    lineHeight: 38,
  },
  subtitle: {
    color: Colors[theme].text,
    opacity: 0.92,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "Rubik_400Regular",
    marginTop: 12,
    marginBottom: 0,
  },
  entryText: {
    fontSize: 18,
    color: Colors[theme].text,
    marginTop: 20,
    fontFamily: "Rubik_400Regular",
    fontWeight: 'bold',
    textAlign: "left",
  },
  classText: {
    fontSize: 18,
    color: Colors[theme].text,
    marginTop: 20,
    fontFamily: "Rubik_400Regular",
    fontWeight: 'bold',
    textAlign: "left",
  },
  input: {
    height: 44,
    width: "100%",
    borderColor: Colors[theme].divider,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    backgroundColor: theme === 'light' ? "#fff" : "rgba(15, 15, 15, 0.38)",
    color: Colors[theme].text,
    fontFamily: "Rubik_400Regular",
    fontSize: 14,
    marginBottom: 16,
  },
  classButtons: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 10,
    gap: 30,
  },
  classButton2: {
    height: 110,
    width: 110,
    backgroundColor: "transparent",
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(56, 182, 255, 0.35)",
    borderRadius: 10,
    color: "#fff",
    fontFamily: "Rubik_400Regular",
    fontWeight: 'bold',
    overflow: "hidden",
  },
  activeFitness: {
    borderColor: "#01f5ff",
    shadowColor: "#1a6094",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.33,
    shadowRadius: 30,
  },
  fitnessIcon: {
    height: 45,
    width: 45,
    marginBottom: 5,
  },
  submitButton: {
    padding: 12,
    borderRadius: 8,
    marginTop: 30,
    alignItems: "center",
    width: "100%",
    shadowColor: "#1a6094",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 28,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    fontWeight: 'bold',
  },
  entryLink: {
    alignItems: "center",
    marginTop: 8,
  },
  viewText: {
    color: "#31edae",
    fontSize: 15,
    fontFamily: "Rubik_400Regular",
    textAlign: "center",
    textDecorationLine: 'underline',
    marginTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  error: {
    marginTop: 5,
    padding: 8,
    backgroundColor: "rgba(255,0,0,0.15)",
    borderRadius: 5,
    color: "#f38b6a",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.3)",
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    textAlign: "center",
    width: "80%",
    alignSelf: "center",
    marginBottom: 10,
  },
});