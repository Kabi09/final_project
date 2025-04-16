const Product = require('../models/productModel');
const ErrorHandler = require('../utils/errorHandler')
const catchAsyncError = require('../middlewares/catchAsyncError')
const APIFeatures = require('../utils/apiFeatures');
const Order = require('../models/orderModel'); // Adjust the path as needed
const User = require('../models/userModel');
const sendEmail = require('../utils/email');

//Get Products - /api/v1/products
exports.getProducts = catchAsyncError(async (req, res, next)=>{
    const resPerPage = 3;
    
    let buildQuery = () => {
        return new APIFeatures(Product.find(), req.query).search().filter()
    }
    
    const filteredProductsCount = await buildQuery().query.countDocuments({})
    const totalProductsCount = await Product.countDocuments({});
    let productsCount = totalProductsCount;

    if(filteredProductsCount !== totalProductsCount) {
        productsCount = filteredProductsCount;
    }
    
    const products = await buildQuery().paginate(resPerPage).query;

    res.status(200).json({
        success : true,
        count: productsCount,
        resPerPage,
        products
    })
})

//Create Product - /api/v1/product/new
exports.newProduct = catchAsyncError(async (req, res, next)=>{
    let images = []
    let BASE_URL = process.env.BACKEND_URL;
    if(process.env.NODE_ENV === "production"){
        BASE_URL = `${req.protocol}://${req.get('host')}`
    }
    
    if(req.files.length > 0) {
        req.files.forEach( file => {
            let url = `${BASE_URL}/uploads/product/${file.originalname}`;
            images.push({ image: url })
        })
    }

    req.body.images = images;

    req.body.user = req.user.id;
    const product = await Product.create(req.body);
    res.status(201).json({
        success: true,
        product
    })
});

//Get Single Product - api/v1/product/:id
exports.getSingleProduct = catchAsyncError(async(req, res, next) => {
    const product = await Product.findById(req.params.id).populate('reviews.user','name email');

    if(!product) {
        return next(new ErrorHandler('Product not found', 400));
    }

    res.status(201).json({
        success: true,
        product
    })
})

//Update Product - api/v1/product/:id
exports.updateProduct = catchAsyncError(async (req, res, next) => {
    let product = await Product.findById(req.params.id);

    //uploading images
    let images = []

    //if images not cleared we keep existing images
    if(req.body.imagesCleared === 'false' ) {
        images = product.images;
    }
    let BASE_URL = process.env.BACKEND_URL;
    if(process.env.NODE_ENV === "production"){
        BASE_URL = `${req.protocol}://${req.get('host')}`
    }

    if(req.files.length > 0) {
        req.files.forEach( file => {
            let url = `${BASE_URL}/uploads/product/${file.originalname}`;
            images.push({ image: url })
        })
    }


    req.body.images = images;
    
    if(!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found"
        });
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    })

    res.status(200).json({
        success: true,
        product
    })

})

//Delete Product - api/v1/product/:id
exports.deleteProduct = catchAsyncError(async (req, res, next) =>{
    const product = await Product.findById(req.params.id);

    if(!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found"
        });
    }

    await product.remove();

    res.status(200).json({
        success: true,
        message: "Product Deleted!"
    })

})
//Create Review - api/v1/review
exports.createReview = catchAsyncError(async (req, res, next) => {
    const { productId, rating, comment, uniquecode } = req.body;

    const userData = await User.findById(req.user.id);
    const now = new Date();

    // Step 1: Check suspension and auto-reset if expired
    if (userData.isSuspended) {
        if (userData.suspensionLiftTime && now >= userData.suspensionLiftTime) {
            // Reset suspension
            userData.isSuspended = false;
            userData.failAttempts = 0;
            userData.suspensionLiftTime = null;
            await userData.save();
        } else {
            return res.status(403).json({
                success: false,
                message: "You are temporarily suspended from posting reviews. Please try again later."
            });
        }
    }

    // Step 2: Validate order and unique code
    const order = await Order.findOne({
        user: req.user.id,
        'orderItems.product': productId,
        uniquecode: uniquecode
    });

    if (!order) {
        // Increment failed attempts
        userData.failAttempts += 1;

        // If 3 attempts fail, suspend for 1 hour and notify user
        if (userData.failAttempts >= 3) {
            userData.isSuspended = true;
            userData.suspensionLiftTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            // Send email notification
            await sendEmail({
                email: userData.email,
                subject: "Review Access Suspended",
                message: `Hi ${userData.name},\n\nYou’ve entered an invalid unique code too many times and are now suspended from posting reviews for 1 hour.`,
                html: `
                    <p>Hi <strong>${userData.name}</strong>,</p>
                    <p>You’ve entered an invalid unique code too many times and are now <b>suspended from posting reviews</b> for <b>1 hour</b>.</p>
                    <p>Please try again later.</p>
                    <br/>
                    <p>— Your Support Team</p>
                `
            });
        }

        await userData.save();

        return res.status(403).json({
            success: false,
            message: userData.isSuspended
                ? "You have been suspended after 3 incorrect attempts. Try again in 1 hour."
                : "Invalid unique code. Please try again."
        });
    }

    // Step 3: Reset failAttempts on success
    userData.failAttempts = 0;
    userData.isSuspended = false;
    userData.suspensionLiftTime = null;
    await userData.save();

    // Step 4: Create or update the review
    const product = await Product.findById(productId);
    if (!product) {
        return res.status(404).json({
            success: false,
            message: "Product not found"
        });
    }

    const review = {
        user: req.user.id,
        rating,
        comment
    };

    const isReviewed = product.reviews.find(
        rev => rev.user.toString() === req.user.id.toString()
    );

    if (isReviewed) {
        product.reviews.forEach(rev => {
            if (rev.user.toString() === req.user.id.toString()) {
                rev.comment = comment;
                rev.rating = rating;
            }
        });
    } else {
        product.reviews.push(review);
        product.numOfReviews = product.reviews.length;
    }

    product.ratings = product.reviews.reduce((acc, item) => item.rating + acc, 0) / product.reviews.length;
    product.ratings = isNaN(product.ratings) ? 0 : product.ratings;

    await product.save({ validateBeforeSave: false });

    res.status(200).json({
        success: true,
        message: isReviewed ? "Review updated successfully" : "Review added successfully"
    });
});

//Get Reviews - api/v1/reviews?id={productId}
exports.getReviews = catchAsyncError(async (req, res, next) =>{
    const product = await Product.findById(req.query.id).populate('reviews.user','name email');

    res.status(200).json({
        success: true,
        reviews: product.reviews
    })
})

//Delete Review - api/v1/review
exports.deleteReview = catchAsyncError(async (req, res, next) =>{
    const product = await Product.findById(req.query.productId);
    
    //filtering the reviews which does match the deleting review id
    const reviews = product.reviews.filter(review => {
       return review._id.toString() !== req.query.id.toString()
    });
    //number of reviews 
    const numOfReviews = reviews.length;

    //finding the average with the filtered reviews
    let ratings = reviews.reduce((acc, review) => {
        return review.rating + acc;
    }, 0) / reviews.length;
    ratings = isNaN(ratings)?0:ratings;

    //save the product document
    await Product.findByIdAndUpdate(req.query.productId, {
        reviews,
        numOfReviews,
        ratings
    })
    res.status(200).json({
        success: true
    })


});

// get admin products  - api/v1/admin/products
exports.getAdminProducts = catchAsyncError(async (req, res, next) =>{
    const products = await Product.find();
    res.status(200).send({
        success: true,
        products
    })
});