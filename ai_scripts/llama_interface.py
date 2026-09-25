# Transformers library is popular for working with LLMs
# AutoTokenizer loads the tokenizer (converts text to tokens) for a given model, AutoModelForCausalLM loads the model itself, pipeline is the API for tasks like text generation
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline
import torch  # Used for tensor operations and model computations

class LLaMAInterface:  # The class for the LLaMA model interface
    def __init__(self, model_name="meta-llama/Llama-3.2-3B-Instruct", device="cuda"):  # Setting self (as usual), setting the model being used, and where the model will be run (cuda = GPU)
        """
        The init function initializes the model and tokenizer.
        Sets everything up to be ready for text generation.
        """
        print("loading model and tokenizer...")  # Shows loading message
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)  # Loads the tokenizer for the specified model - converts the text into tokens
        self.model = AutoModelForCausalLM.from_pretrained(model_name)  # Loads the actual model for generating text
        self.device = device  # Tells us where to run the model (cpu or cuda for GPU)
        if device != "cuda":  # If the device is not cuda (GPU), move the model to the specified device (like CPU)
            self.model.to(device)  # Sets the model to run on the specified device
        print(f"Device set to use {device}")  # Confirms which device is being used

    def generate(self, prompt, max_new_tokens=150):  # The generate function
        """
        The AI creates a text-generation pipeline using the model and tokenizer.
        It takes in the prompt and generates text up to max_new_tokens.
        When taking in the prompt, it processes it through the pipeline and returns the generated text.
        It converts the output to a string and returns it.
        It takes in the prompt and uses the tokenizer to convert it to tokens.
        Then, it uses the model to generate new tokens based on the input tokens.
        """
        pipe = pipeline(  # Calls the pipeline function to create a text generation pipeline
            "text-generation",  # Specifies the task type as text generation
            model=self.model,  # Uses the loaded model (self.model set above)
            tokenizer=self.tokenizer,  # Uses the loaded tokenizer (also set above)
            device=0 if self.device != "cpu" else -1  # Sets device for the pipeline (0 for GPU, -1 for CPU)
        )
        output = pipe(prompt, max_new_tokens=max_new_tokens)  # Generates text based on the prompt, limiting to max_new_tokens
        return output[0]['generated_text']  # Returns the generated text from the output