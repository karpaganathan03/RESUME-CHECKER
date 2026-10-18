i want to build an HTML, CSS, JS landing page for my resume parser, where I should be able to upload an PDF and get the score out of it. Here I just want to see the score, what skills are present, and what skills are missing. And I'm gonna call this as 0 to shipped resume parser. This is gonna be a mock design, so just build html css is fine, no back-end server is needed.
 I want to convert this entire project into a react project.
 I want you to move this react project into frontend folder and build a backend folder that contains the express server to handle the request, lets connect to mongoDB.
 The application should take resume PDF and a JD for comparison, AI part will be added later
 backend folder should container server.js, routes folder, controller folder, service folder, config folder, middleware folder and utils.js
add vercel.json file to backend and frontend folder, I am going to create two projects in vercel for deployment
backend folder should be in the order like container server.js, routes folder, controller.js, service folder, config folder, middleware folder, and util.js
Delete unnecessary folder
keep the project order professionaly like backend-->Database-->server-->Frontend 
I didn't deploy the frontend seperately rather i had build both simulataneously according to my conditions make the possible changes in the project keep in mind i'm not going to deploy frontend and backend seperately i m going to deploy as a MERN stack project make alternatives regarding to that.
lets connect the labd AI and parse the resume and give the score for this i'm gonna use the  labd APIkey while deployment

12: Separate frontend and backend for independent deployment: added frontend/vercel.json and backend/vercel.json, created backend/api/index.js entry point, updated CORS to allow separate frontend origins, created root index.html to prevent local static directory listing, and fixed MongoDB credentials in backend/.env.
13: Configured repository for Vercel Services multi-service deployment: added services configuration for backend (Express) and frontend (Vite) with top-level rewrites (/api/(.*) -> backend, /(.*) -> frontend), added GET /api route, and bundled skills.txt.
13: Configured repository for Vercel Services multi-service deployment: added services configuration for backend (Express) and frontend (Vite) with top-level rewrites (/api/(.*) -> backend, /(.*) -> frontend), added GET /api route, and bundled skills.txt.
12: Separate frontend and backend for independent deployment: added frontend/vercel.json and backend/vercel.json, created backend/api/index.js entry point, updated CORS to allow separate frontend origins, created root index.html to prevent local static directory listing, and fixed MongoDB credentials in backend/.env.