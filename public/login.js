<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Café Amore | Login</title>
    <link rel="stylesheet" href="login.css">
    <link rel="stylesheet" href="customer-nav.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
    
        .password-input-wrapper {
            position: relative; 
            margin-bottom: 12px; 
        }

        .password-input-wrapper .password-field {
            padding-right: 40px; 
            margin-bottom: 0; 
            width: 100%;
            box-sizing: border-box; 
        }

        .toggle-password {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%); 
            cursor: pointer;
            color: #a65b35; 
            z-index: 10;
            font-size: 1.1em;
            transition: color 0.2s;
        }

        .toggle-password:hover {
            color: #552915;
        }

        .login-box label {
            display: block;
            margin-bottom: 5px; 
            font-weight: bold; 
            text-align: left;
            color: #f2e6dc; 
        }
    </style>
</head>
<body>

    <nav class="customer-nav">
        <a href="index.html" class="logo">
            <img src="logo.png" alt="Café Amore Logo"> Café Amore
        </a>
        <ul>
            <li id="homeLink">
                <a href="index.html"><i class="fas fa-home"></i> <span>Home</span></a>
            </li>
            <li id="menuLink">
                <a href="menu.html"><i class="fas fa-utensils"></i> <span>Menu</span></a>
            </li>
        </ul>
    </nav>

    <div class="login-wrapper">
        <div class="login-container">

            <div class="login-left">
                <img src="logo.png" alt="Coffee Illustration" class="coffee-img">
                <h2>Find the Best Coffee</h2>
                <p>Delivery within Bacoor.</p>
            </div>

            <div class="login-right">
                <div class="login-box">
                    <h2>Welcome Back</h2>
                    <p>Please login to your account</p>
                    <form id="loginForm">
                        <input type="email" id="loginEmail" placeholder="Email Address" required>
                        
                        <label for="loginPassword">Password</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="loginPassword" class="password-field" placeholder="Password" required>
                            <i class="fas fa-eye toggle-password" data-target="loginPassword" id="togglePassword"></i>
                        </div>
                        
                        <button type="submit" class="signin-btn">Sign In</button>
                    </form>
                    <a href="#" id="forgotPassword" class="forgot-link">Forgot Password?</a>
                    <p class="register-text">New to Café Amore? <a href="registration.html">Create Account</a></p>
                </div>
            </div>

        </div>
    </div>

    <div id="forgotPopup" class="forgot-popup">
        <div class="forgot-content">
            <span id="closeForgot" class="close-btn">&times;</span>
            <h3>Reset Password</h3>
            <p>Enter your email to receive a password reset link.</p>
            <input type="email" id="resetEmail" placeholder="Email Address" required>
            <button id="sendReset">Send Reset Link</button>
        </div>
    </div>

    <div id="messagePopup" class="message-popup">
        <div class="message-content">
            <p id="messageText"></p>
            <button id="resendVerificationBtn" class="ok-btn" style="display: none; margin-top: 10px;">Resend Verification Link</button>
            <button id="okMessage" class="ok-btn">OK</button>
        </div>
    </div>

    <div id="otpPopup" class="otp-popup">
        <div class="otp-content">
            <span id="closeOtpBtn" class="close-btn">&times;</span>
            <h3>Enter OTP</h3>
            <p>We sent a code to your phone number: <span id="maskedPhone"></span></p>
            <input type="text" id="otpCode" placeholder="Enter OTP" required>
            <p id="otpError" class="otp-error" style="color: red; display: none; margin-top: 5px;"></p>
            <button id="verifyOtpBtn">Verify OTP</button>
        </div>
    </div>

    <div id="recaptcha-container"></div>

    <script type="module" src="login.js"></script>
    <script>
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('loginPassword');

    togglePassword.addEventListener('click', function (e) {
        const newType = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', newType);
        
        if (newType === 'text') {
            this.classList.remove('fa-eye');
            this.classList.add('fa-eye-slash');
        } else {
            this.classList.remove('fa-eye-slash');
            this.classList.add('fa-eye');
        }
    });
    </script>

</body>
</html>
