const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    const transport = {
        host: process.env.SMTP_HOST || 'smtp.example.com',
        port: process.env.SMTP_PORT || 587,
        auth: {
            user: process.env.SMTP_USER || 'you@example.com',
            pass: process.env.SMTP_PASS || 'yourpassword'
        }
    };

    const transporter = nodemailer.createTransport(transport);

    const message = {
        from: `${process.env.SMTP_FROM_NAME || 'YourApp'} <${process.env.SMTP_FROM_EMAIL || 'noreply@yourapp.com'}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html || null // Optional HTML version
    };

    await transporter.sendMail(message);
};

module.exports = sendEmail;
