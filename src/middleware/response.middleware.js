function responseMiddleware(req, res, next) {
  res.success = function success(data, statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      data
    });
  };

  next();
}

module.exports = responseMiddleware;
