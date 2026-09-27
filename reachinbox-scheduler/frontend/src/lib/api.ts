import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send the session_token cookie set by the backend
});

export const endpoints = {
  loginUrl: `${API_URL}/api/auth/google`,
  slackConnectUrl: `${API_URL}/api/slack/oauth/start`,
};
