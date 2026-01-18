# AssetVerse - Backend

**AssetVerse** is a comprehensive Asset Management System designed to help businesses track and manage their assets efficiently. This repository contains the backend server code, built with **Express.js** and **MongoDB**, facilitating secure data handling, user management, and payment processing.

## 🚀 Features

- **RESTful API**: Robust endpoints for Users, Assets, Requests, and Employee management.
- **Database**: Utilizing **MongoDB** for flexible and scalable data storage.
- **Authentication**: Secure user authentication and verification using **Firebase Admin SDK**.
- **Payment Integration**: Seamless payment processing with **Stripe**.
- **Role-Based Access Control**: distinct functionalities for **HR Managers** and **Employees**.
- **Secure Environment**: Environment variable management for sensitive keys.

## 🛠️ Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [MongoDB](https://www.mongodb.com/)
- **Authentication**: [Firebase Admin](https://firebase.google.com/docs/admin/setup)
- **Payments**: [Stripe](https://stripe.com/)
- **Utilities**: `dotenv` (Configuration), `cors` (Cross-Origin Resource Sharing)

## 📂 Project Structure

```bash
B12A11/
├── index.js                # Main server entry point
├── package.json            # Dependencies and scripts
├── .env                    # Environment variables (not committed)
├── firebaseadminkey.json   # Firebase service account key
└── serviceAccountKey.json  # Additional service account key (if applicable)
```

## ⚙️ Installation & Setup

1.  **Clone the repository**:

    ```bash
    git clone <repository_url>
    cd B12A11
    ```

2.  **Install dependencies**:

    ```bash
    npm install
    ```

3.  **Environment Configuration**:
    Create a `.env` file in the root directory and add the following variables:

    ```env
    URI=your_mongodb_connection_string
    STRIPEKEY=your_stripe_secret_key
    ```

    _Ensure you have your Firebase Admin SDK keys (`firebaseadminkey.json`) placed in the root directory._

4.  **Start the Server**:
    ```bash
    npm start
    ```
    The server will typically run on the port defined in your environment or default to 5000 (check console output).

## 🔑 Key API Endpoints

| Method  | Endpoint                     | Description                           | Access   |
| :------ | :--------------------------- | :------------------------------------ | :------- |
| `POST`  | `/user`                      | Create a new user (HR or Employee)    | Public   |
| `GET`   | `/assetcollection`           | Fetch assets with pagination & search | HR       |
| `POST`  | `/assetcollection`           | Add a new asset                       | HR       |
| `POST`  | `/asset-requests`            | Employee requests an asset            | Employee |
| `PATCH` | `/asset-request/approve/:id` | Approve an asset request              | HR       |

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a pull request for any enhancements or bug fixes.

## 📄 License

This project is licensed under the ISC License.
