const db = require("../db.js");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const createToken = require('../functions/createToken');

const register = async (req, res) => {
    try {
        const { username, password } = req?.body
        const user_id = uuidv4();
        if (!username) throw Error("Username not found");
        // if (!mobile_no) throw Error("Mobile number not found");
        if (!password) throw Error("Password not found");
        const hash = await bcrypt.hash(password, 10);

        const insertValue = `INSERT INTO "user" (user_id, username, password) VALUES ($1, $2, $3, $4) RETURNING *`;
        const output = await db.query(insertValue, [user_id, username, hash]);
        const user = output?.rows?.[0];
        res.status(200).json({ message: `User ${user?.username} is registered successfully` })
    } catch (error) {
        res.status(400).json({ message: error?.message })
    }
}

const login = async (req, res) => {
    try {
        const { username, password } = req?.body

        if (!username) throw Error("Username not found");
        if (!password) throw Error("Password not found");

        const loginQuery = `SELECT * FROM "user" WHERE username=$1`;
        const output = await db.query(loginQuery, [username]);
        const user = output?.rows?.[0];
        const isPasswordCorrect = await bcrypt.compare(password, user?.password);
        if (!isPasswordCorrect) {
            throw Error("Passowrd Incorrect");
        }
        delete user.password; 
        const token = await createToken(user);
        res.status(200).json({ token })
    } catch (error) {
        res.status(400).json({ message: error?.message })
    }
}

module.exports = { register, login }