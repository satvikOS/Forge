# GEMINI TESTING GUIDE

This guide will walk you through the step-by-step process for testing the **Gemini API integration** with **ArchDisc**. It's designed for complete beginners, so don’t worry if you have no prior experience.

## 1. Prerequisites and Setup
Before getting started, make sure you have the following installed:
- [Node.js](https://nodejs.org/en/download/) (version 14 or higher)
- [Git](https://git-scm.com/downloads)
- A code editor like [Visual Studio Code](https://code.visualstudio.com/) or [Atom](https://atom.io/)

## 2. Getting a Gemini API Key from Google AI Studio
1. Navigate to [Google AI Studio](https://ai.google.com/about/gemini).
2. Sign in with your Google account.
3. Follow the prompts to create a new project and request your API key.
4. Save your API key safely as you’ll need it later.

*Screenshots:*  
![](https://link.to/screenshot_of_google_ai_studio)

## 3. Configuring Environment Variables
1. Open your terminal or command prompt.
2. Navigate to your project directory:  
   ```bash
   cd path/to/your/project
   ```
3. Create a `.env` file in the root of your project and add your API key:
   ```plaintext
   GEMINI_API_KEY=your_api_key_here
   ```

## 4. Starting the Backend and Frontend Servers
### Starting the Backend Server
1. Navigate to the backend directory:  
   ```bash
   cd backend
   ```
2. Install dependencies:  
   ```bash
   npm install
   ```
3. Start the server:  
   ```bash
   npm start
   ```

### Starting the Frontend Server
1. Open another terminal window.
2. Navigate to the frontend directory:  
   ```bash
   cd frontend
   ```
3. Install dependencies:  
   ```bash
   npm install
   ```
4. Start the frontend:  
   ```bash
   npm start
   ```

*Expected output* for both servers should indicate they are running, e.g., `Server is running on http://localhost:3000`.

## 5. Testing with Simple Prompts
Once the servers are running, you can test the integration:
- Open your frontend in the browser: `http://localhost:3000`
- Enter one of the following prompts in the testing area:
  - **Building**: "Create a modern house design."
  - **Car**: "Design an electric vehicle."
  - **Furniture**: "Generate a new table design."

*Expected outputs* will include 3D models generated based on your prompts.

## 6. Understanding the Response Flow
The response from the Gemini API follows this structure:
- A 3D model file URL
- Status message
Take note of the status to understand if your request was processed successfully.

## 7. Troubleshooting Common Issues
Here are some common issues you may encounter:
- **API Key Errors**: Ensure that your API key is correctly placed in your `.env` file.
- **Server Not Starting**: Check for any errors in the terminal; ensure all dependencies are installed.

## 8. Example Prompts for Different Industries
- **Healthcare**: "Create a 3D model of a hospital ward."
- **Education**: "Generate a classroom layout."
- **Retail**: "Design a virtual store setup."

## 9. How to View Generated 3D Models
1. Once you receive a 3D model URL in the response, click on the link.
2. You can view and interact with the model. If your browser supports WebGL, it should display the 3D model correctly.

## 10. Next Steps for Enhancement
- Explore advanced features of the Gemini API.
- Implement additional functionalities in ArchDisc based on your testing experience.

---

This guide aims to provide everything you need to know to get started with the Gemini API integration in ArchDisc. Happy testing!