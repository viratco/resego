const jwt = require('jsonwebtoken');

function createToken(obj) {
    return jwt.sign(obj, process.env.JWT_SECRET_KEY, { expiresIn: 60 * 60 * 60 });
}

module.exports = createToken;