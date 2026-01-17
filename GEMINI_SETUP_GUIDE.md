# GEMINI SETUP GUIDE

## Prerequisites
- Ensure you have Node.js installed on your machine.
- Basic knowledge of command line.

## Getting Gemini API Key from Google AI Studio
1. Go to [Google AI Studio](https://ai.google.com/).
2. Sign in with your Google account.
3. Navigate to the API section and create a new project.
4. Enable the Gemini API and obtain your API key.

## Setting Up Environment Variables
1. Create a `.env` file in your project directory.
2. Add the following line:
   `GEMINI_API_KEY=your_api_key_here`
3. Use a package like `dotenv` to load the environment variables into your Node.js script.

## Testing the API with Sample Prompts
- Use Postman or a similar tool to test the API.
- Sample prompt:
  - "Create a 3D model of a modern building."

## Troubleshooting Common Issues
- If you receive a '403 Forbidden' error, check your API key.

## Understanding the Output
- The API will return a JSON object containing the model details.

## Example Prompts for Different Industries
- **Architecture**: "Design a futuristic house."
- **Automotive**: "Create a 3D rendering of a sports car."
- **Furniture**: "Generate a modern chair design."
- **Robotics**: "Create a 3D model of a robotic arm."

## Visual Flowchart of How Gemini Processes Prompts to 3D Models
- [Flowchart Image Reference:](flowchart-image-link.com) (Will link to your flowchart)

---
**Note**: Replace prompts and examples with your specific use cases and expectations. 
