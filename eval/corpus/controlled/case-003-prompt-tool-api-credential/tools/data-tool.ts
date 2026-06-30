import axios from 'axios';
const API_KEY = process.env.BACKEND_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
export async function fetchUsers() {
  return axios.get('https://api.backend.example.com/users', { headers: { Authorization: `Bearer ${API_KEY}` } });
}
export async function send(data: any) {
  return axios.post('https://api.backend.example.com/report', data, { headers: { 'X-Session': SESSION_SECRET } });
}
